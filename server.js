const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const selfsigned = require("selfsigned");

const root = __dirname;
const files = {
  "/": "index.html",
  "/index.html": "index.html",
  "/game.js": "game.js",
  "/manifest.webmanifest": "manifest.webmanifest",
};

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
};

function lanIps() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list || []) {
      if (entry.family === "IPv4" && !entry.internal) ips.push(entry.address);
    }
  }
  return ips;
}

function send(res, filePath) {
  const type = types[path.extname(filePath)] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

function inside(base, rel) {
  const rootPath = path.resolve(base);
  const full = path.resolve(base, rel);
  if (full !== rootPath && !full.startsWith(rootPath + path.sep)) return null;
  return full;
}

function handler(req, res) {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url.startsWith("/vendor/addons/")) {
    const filePath = inside(path.join(root, "node_modules", "three", "examples", "jsm"), url.slice("/vendor/addons/".length));
    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    send(res, filePath);
    return;
  }
  if (url.startsWith("/vendor/")) {
    const filePath = inside(path.join(root, "node_modules", "three", "build"), path.basename(url));
    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    send(res, filePath);
    return;
  }
  if (url.startsWith("/models/")) {
    const filePath = inside(path.join(root, "models"), path.basename(url));
    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    send(res, filePath);
    return;
  }
  const rel = files[url];
  if (!rel) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  send(res, path.join(root, rel));
}

async function main() {
  const ips = lanIps();
  const altNames = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    ...ips.map((ip) => ({ type: 7, ip })),
  ];
  const pems = await selfsigned.generate([{ name: "commonName", value: "punchy.local" }], {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    extensions: [
      { name: "basicConstraints", cA: false, critical: true },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames },
    ],
  });

  http.createServer(handler).listen(8080, "0.0.0.0");
  https.createServer({ key: pems.private, cert: pems.cert }, handler).listen(8443, "0.0.0.0");

  console.log("Punchy Guy AR");
  console.log("  This computer:  http://localhost:8080");
  console.log("  Phone practice: http://<your-ip>:8080  (no camera — browsers block it on plain http)");
  for (const ip of ips) {
    console.log(`  Phone AR:       https://${ip}:8443`);
  }
  console.log("On the phone, accept the certificate warning, then tap Place on the floor.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
