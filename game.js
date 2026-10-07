import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

const DT = 1 / 60;
const GRAVITY = 28;
const BEST_KEY = "punchy-guy-kos";

const $ = (id) => document.getElementById(id);
const koCount = $("ko-count");
const comboEl = $("combo");
const heartsEl = $("hearts");
const reticle = $("reticle");
const playfield = $("playfield");
const fxCanvas = $("fx");
const fxCtx = fxCanvas.getContext("2d");
const video = $("cam");
const flashEl = $("flash");
const hurtEl = $("hurt");

const game = {
  mode: "boot",
  ar: false,
  kos: 0,
  hearts: 3,
  combo: 0,
  comboLeft: 0,
  wave: 1,
  spawning: 0,
  leftToSpawn: [],
  over: false,
  invuln: 0,
  shake: 0,
  muted: false,
  gyro: false,
  calibrated: false,
  xr: false,
  placed: true,
  floorY: 0,
  hitReady: false,
};

window.__punchy = game;

const audio = {
  ctx: null,
  ensure() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },
  blip({ from, to, dur, type = "sine", gain = 0.25, noise = 0 }) {
    if (game.muted) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + dur);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    if (noise > 0) {
      const len = Math.floor(ctx.sampleRate * dur);
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      const ng = ctx.createGain();
      src.buffer = buffer;
      ng.gain.setValueAtTime(noise, t);
      src.connect(ng);
      ng.connect(ctx.destination);
      src.start(t);
    }
  },
  jab() { this.blip({ from: 210, to: 50, dur: 0.14, gain: 0.28, noise: 0.18 }); },
  hook() { this.blip({ from: 160, to: 42, dur: 0.18, gain: 0.32, noise: 0.22 }); },
  upper() { this.blip({ from: 320, to: 70, dur: 0.22, type: "triangle", gain: 0.3, noise: 0.16 }); },
  ko() { this.blip({ from: 90, to: 40, dur: 0.28, gain: 0.4, noise: 0.28 }); },
  hurt() { this.blip({ from: 120, to: 36, dur: 0.2, type: "sawtooth", gain: 0.18, noise: 0.1 }); },
};

const renderer = new THREE.WebGLRenderer({
  canvas: $("gl"),
  alpha: true,
  antialias: true,
  powerPreference: "high-performance",
  premultipliedAlpha: false,
});
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 80);
const rig = new THREE.Group();
scene.add(rig);
rig.add(camera);
camera.position.set(0, 0, 0);
rig.position.set(0, 1.55, 0);

scene.add(new THREE.HemisphereLight(0xfff6ea, 0x9eb0c4, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.45);
sun.position.set(3, 8, 2);
scene.add(sun);
const camLight = new THREE.PointLight(0xfff4e8, 2.2, 0, 2);
camLight.position.set(0, 0.35, 0.2);
camera.add(camLight);

const gradientMap = (() => {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 1;
  const g = c.getContext("2d");
  ["#5c564f", "#9a928a", "#f3f0ea", "#ffffff"].forEach((hex, i) => {
    g.fillStyle = hex;
    g.fillRect(i, 0, 1, 1);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

function paintTexture(draw) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  draw(c.getContext("2d"), c);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function fuzzyTexture(hex) {
  return paintTexture((g) => {
    g.fillStyle = hex;
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 520; i++) {
      g.fillStyle = Math.random() > 0.45 ? "rgba(40,18,10,0.22)" : "rgba(255,236,214,0.16)";
      g.beginPath();
      g.ellipse(Math.random() * 128, Math.random() * 128, 1.5 + Math.random() * 4, 1 + Math.random() * 2.2, Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
}

const looks = {
  fuzz: { map: fuzzyTexture("#6b3d28"), glove: "#2a211c", outline: "#24160f" },
  fuzz2: { map: fuzzyTexture("#8a4b2f"), glove: "#241910", outline: "#24160f" },
  boxer: { map: null, color: "#ffe14a", glove: "#e23a2b", outline: "#3a2a08" },
  striker: { map: null, color: "#24324a", glove: "#ff8a3d", outline: "#140e18" },
};

function toonMaterial(look) {
  return new THREE.MeshToonMaterial({
    map: look.map || null,
    color: look.map ? 0xffffff : look.color,
    gradientMap,
    emissive: 0x000000,
  });
}

const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1a140f, side: THREE.BackSide });
const skinMat = toonMaterial({ color: "#f0c2a0" });
const gloveMat = toonMaterial({ color: "#e23a2b" });
const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x16120f });
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x1a140f, transparent: true, opacity: 0.28, depthWrite: false });

const geo = {
  bone: new THREE.CylinderGeometry(1, 1, 1, 7),
  head: new THREE.SphereGeometry(0.2, 16, 12),
  joint: new THREE.SphereGeometry(1, 10, 8),
  eye: new THREE.SphereGeometry(0.065, 10, 8),
  pupil: new THREE.SphereGeometry(0.032, 8, 6),
  glove: new THREE.SphereGeometry(0.15, 16, 12),
  cuff: new THREE.CylinderGeometry(0.07, 0.085, 0.16, 10),
  arm: new THREE.CylinderGeometry(0.055, 0.07, 1, 8),
  shadow: new THREE.CircleGeometry(0.55, 18),
  spark: new THREE.PlaneGeometry(0.28, 0.28),
  ring: new THREE.RingGeometry(0.25, 0.38, 20),
};

function addOutline(mesh) {
  const shell = new THREE.Mesh(mesh.geometry, outlineMat);
  shell.scale.setScalar(1.08);
  mesh.add(shell);
  return mesh;
}

const floorTex = paintTexture((g) => {
  g.fillStyle = "#d7e4f4";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#c5d4ea";
  g.fillRect(0, 0, 64, 64);
  g.fillRect(64, 64, 64, 64);
});
floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
floorTex.repeat.set(24, 24);
floorTex.magFilter = THREE.NearestFilter;

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshBasicMaterial({ map: floorTex }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const skyCanvas = document.createElement("canvas");
skyCanvas.width = 4;
skyCanvas.height = 256;
{
  const g = skyCanvas.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#7fdcea");
  grd.addColorStop(0.48, "#c9d8f6");
  grd.addColorStop(1, "#dce6f8");
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
}
const skyTex = new THREE.CanvasTexture(skyCanvas);
skyTex.colorSpace = THREE.SRGBColorSpace;
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(60, 24, 16),
  new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide }),
);
scene.add(sky);

const starPositions = new Float32Array(160 * 3);
for (let i = 0; i < 160; i++) {
  const angle = Math.random() * Math.PI * 2;
  const rise = Math.random();
  const radius = 18 + Math.random() * 16;
  starPositions[i * 3] = Math.cos(angle) * radius;
  starPositions[i * 3 + 1] = 4 + rise * 16;
  starPositions[i * 3 + 2] = Math.sin(angle) * radius;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false }));
scene.add(stars);

const BONES = [
  ["hips", "chest", 0.16],
  ["chest", "head", 0.1],
  ["chest", "lSh", 0.085],
  ["lSh", "lHand", 0.07],
  ["chest", "rSh", 0.085],
  ["rSh", "rHand", 0.07],
  ["hips", "lKnee", 0.1],
  ["lKnee", "lFoot", 0.08],
  ["hips", "rKnee", 0.1],
  ["rKnee", "rFoot", 0.08],
];

const BASE_POSE = {
  hips: [0, 0.92, 0],
  chest: [0, 1.28, 0],
  head: [0, 1.64, 0.02],
  lSh: [-0.28, 1.4, 0],
  rSh: [0.28, 1.4, 0],
  lHand: [-0.4, 1.02, 0.05],
  rHand: [0.4, 1.02, 0.05],
  lKnee: [-0.13, 0.48, 0],
  rKnee: [0.13, 0.48, 0],
  lFoot: [-0.14, 0.08, 0.05],
  rFoot: [0.14, 0.08, 0.05],
};

const enemies = [];
const tmp = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  fwd: new THREE.Vector3(),
  right: new THREE.Vector3(),
  cam: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0),
  y: new THREE.Vector3(0, 1, 0),
};

function makeEnemy(kind, x, z) {
  const model = cloneSkinned(robotTemplate);
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.frustumCulled = false;
    obj.castShadow = false;
    if (Array.isArray(obj.material)) obj.material = obj.material.map((mat) => mat.clone());
    else if (obj.material) obj.material = obj.material.clone();
  });
  model.scale.setScalar(0.55);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  if (clips.walk) {
    actions.walk = mixer.clipAction(clips.walk);
    actions.walk.play();
  }
  if (clips.die) actions.die = mixer.clipAction(clips.die);
  const group = new THREE.Group();
  group.add(model);
  scene.add(group);
  const shadow = new THREE.Mesh(geo.shadow, shadowMat.clone());
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);
  const enemy = {
    kind,
    group,
    model,
    mixer,
    actions,
    parts: {
      hips: { pos: new THREE.Vector3() },
      chest: { pos: new THREE.Vector3() },
      head: { pos: new THREE.Vector3() },
    },
    shadow,
    root: new THREE.Vector3(x, 0, z),
    yaw: 0,
    lift: 0,
    roll: 0,
    vel: new THREE.Vector3(),
    spin: 0,
    dynamic: false,
    alive: true,
    ko: false,
    age: 0,
    phase: Math.random() * 6,
    speed: 0.85,
    attack: 1.1 + Math.random() * 0.4,
    lunge: 0,
    settle: 0,
    linkR: null,
    flash: 0,
    removeIn: 0,
  };
  layoutEnemy(enemy, 0);
  enemies.push(enemy);
  return enemy;
}

function layoutEnemy(enemy) {
  enemy.group.position.set(enemy.root.x, game.floorY + enemy.lift, enemy.root.z);
  enemy.group.rotation.set(0, enemy.yaw, enemy.roll);
  const base = enemy.group.position;
  enemy.parts.hips.pos.set(base.x, base.y + 0.2, base.z);
  enemy.parts.chest.pos.set(base.x, base.y + 0.9, base.z);
  enemy.parts.head.pos.set(base.x, base.y + 1.45, base.z);
}

function integrateEnemy(enemy, dt) {
  enemy.vel.y -= 22 * dt;
  enemy.root.x += enemy.vel.x * dt;
  enemy.root.z += enemy.vel.z * dt;
  enemy.lift += enemy.vel.y * dt;
  enemy.roll += enemy.spin * dt;
  if (enemy.lift < 0) {
    enemy.lift = 0;
    enemy.vel.y *= -0.3;
    enemy.vel.x *= 0.55;
    enemy.vel.z *= 0.55;
    enemy.spin *= 0.65;
  }
  layoutEnemy(enemy);
}

function syncEnemy(enemy, dt) {
  if (enemy.mixer) enemy.mixer.update(dt);
  enemy.shadow.position.set(enemy.root.x, game.floorY + 0.02, enemy.root.z);
  const hot = enemy.flash > 0;
  enemy.model.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat.emissive) continue;
      mat.emissive.setHex(hot ? 0xff6a2a : 0x000000);
      mat.emissiveIntensity = hot ? 0.7 : 0;
    }
  });
}

function launchEnemy(enemy, dir, power, lift) {
  const fresh = !enemy.dynamic;
  enemy.dynamic = true;
  enemy.alive = false;
  enemy.linkR = null;
  for (const other of enemies) if (other.linkR === enemy) other.linkR = null;
  enemy.vel.copy(dir).multiplyScalar(power * 0.9);
  enemy.vel.y += lift;
  enemy.spin = (Math.random() > 0.5 ? 1 : -1) * (5 + Math.random() * 4);
  if (enemy.actions.walk) enemy.actions.walk.fadeOut(0.12);
  if (enemy.actions.die) enemy.actions.die.reset().fadeIn(0.08).play();
  enemy.flash = 0.18;
  return fresh;
}

function disposeEnemy(enemy) {
  scene.remove(enemy.group);
  scene.remove(enemy.shadow);
  if (enemy.mixer) enemy.mixer.stopAllAction();
  enemy.shadow.material.dispose();
}

const sparks = [];
for (let i = 0; i < 36; i++) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffe08a,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo.spark, mat);
  mesh.visible = false;
  scene.add(mesh);
  sparks.push({ mesh, life: 0, vel: new THREE.Vector3() });
}

function burst(pos, color, count, speed, up = 1) {
  let left = count;
  for (const spark of sparks) {
    if (left <= 0) break;
    if (spark.life > 0) continue;
    spark.life = 0.35 + Math.random() * 0.25;
    spark.mesh.visible = true;
    spark.mesh.position.copy(pos);
    spark.mesh.material.color.set(color);
    spark.vel.set((Math.random() - 0.5) * speed, Math.random() * speed * up, (Math.random() - 0.5) * speed);
    left--;
  }
}

const ring = new THREE.Mesh(
  geo.ring,
  new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
);
ring.rotation.x = -Math.PI / 2;
ring.visible = false;
scene.add(ring);
let ringLife = 0;

const anchor = new THREE.Vector3();
const hitMatrix = new THREE.Matrix4();
const hitNormal = new THREE.Vector3();
const placeReticle = new THREE.Mesh(
  new THREE.RingGeometry(0.16, 0.22, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffe14a, side: THREE.DoubleSide, depthWrite: false }),
);
placeReticle.matrixAutoUpdate = false;
placeReticle.visible = false;
scene.add(placeReticle);
const spot = new THREE.Mesh(
  new THREE.RingGeometry(0.85, 0.98, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xe23a2b, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }),
);
spot.visible = false;
scene.add(spot);
let hitTestSource = null;

function shock(pos) {
  ring.visible = true;
  ring.position.set(pos.x, game.floorY + 0.04, pos.z);
  ring.scale.setScalar(0.4);
  ring.material.opacity = 0.9;
  ringLife = 0.28;
}

const fist = new THREE.Group();
camera.add(fist);
const glove = addOutline(new THREE.Mesh(geo.glove, gloveMat));
glove.scale.set(1.15, 0.82, 1.35);
fist.add(glove);
const knuckle = addOutline(new THREE.Mesh(geo.glove, gloveMat));
knuckle.scale.set(0.72, 0.38, 0.42);
knuckle.position.set(0, 0.1, -0.12);
fist.add(knuckle);
const cuff = new THREE.Mesh(geo.cuff, skinMat);
cuff.rotation.x = Math.PI / 2;
cuff.position.set(0, -0.02, 0.18);
fist.add(cuff);
const forearm = new THREE.Mesh(geo.arm, skinMat);
forearm.rotation.x = Math.PI / 2;
forearm.position.set(0, -0.04, 0.7);
forearm.scale.set(1, 0.85, 0.9);
fist.add(forearm);

const punch = {
  active: false,
  t: 0,
  type: "jab",
  hook: 1,
  didHit: false,
  aim: new THREE.Vector3(0, 0.05, -1),
  rest: new THREE.Vector3(0.1, -0.28, -0.48),
  shoulder: new THREE.Vector3(0.18, -0.78, -0.12),
};

function punchCurve(t) {
  if (t < 0.34) return 1 - Math.pow(1 - t / 0.34, 3);
  return Math.max(0, 1 - Math.pow((t - 0.34) / 0.66, 2));
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  fxCanvas.width = w;
  fxCanvas.height = h;
}
window.addEventListener("resize", resize);
resize();

const zee = new THREE.Vector3(0, 0, 1);
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const orientEuler = new THREE.Euler();
const deviceQuat = new THREE.Quaternion();
const qOffset = new THREE.Quaternion();

function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === "number") {
    return THREE.MathUtils.degToRad(screen.orientation.angle);
  }
  return THREE.MathUtils.degToRad(window.orientation || 0);
}

function setDeviceQuaternion(quaternion, alpha, beta, gamma, orient) {
  orientEuler.set(beta, alpha, -gamma, "YXZ");
  quaternion.setFromEuler(orientEuler);
  quaternion.multiply(q1);
  quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
}

function onOrientation(event) {
  if (event.alpha == null || game.mode !== "play" || !game.ar || game.xr || renderer.xr.isPresenting) return;
  const alpha = THREE.MathUtils.degToRad(event.alpha);
  const beta = THREE.MathUtils.degToRad(event.beta || 0);
  const gamma = THREE.MathUtils.degToRad(event.gamma || 0);
  setDeviceQuaternion(deviceQuat, alpha, beta, gamma, screenAngle());
  if (!game.calibrated) {
    qOffset.copy(deviceQuat).invert();
    game.calibrated = true;
    game.gyro = true;
    $("recenter").hidden = false;
  }
  rig.quaternion.copy(qOffset).multiply(deviceQuat);
}

window.addEventListener("deviceorientationabsolute", onOrientation, true);
window.addEventListener("deviceorientation", onOrientation, true);

function recenter() {
  if (!game.gyro) return;
  qOffset.copy(deviceQuat).invert();
}

function playerXZ() {
  camera.getWorldPosition(tmp.cam);
  return tmp.cam;
}

function flatForward() {
  camera.getWorldDirection(tmp.fwd);
  tmp.fwd.y = 0;
  if (tmp.fwd.lengthSq() < 0.0001) tmp.fwd.set(0, 0, -1);
  tmp.fwd.normalize();
  tmp.right.crossVectors(tmp.fwd, tmp.up).normalize();
}

function waveKinds(n) {
  const table = [
    ["fuzz", "fuzz"],
    ["fuzz", "boxer"],
    ["fuzz", "fuzz", "fuzz"],
    ["boxer", "striker"],
    ["fuzz", "boxer", "striker"],
    ["fuzz", "fuzz", "boxer", "striker"],
  ];
  if (n - 1 < table.length) return table[n - 1].slice();
  const pool = ["fuzz", "fuzz", "boxer", "striker"];
  const count = Math.min(5, 3 + Math.floor((n - 6) / 2));
  return Array.from({ length: count }, (_, i) => pool[(n + i) % pool.length]);
}

function beginWave() {
  game.leftToSpawn = waveKinds(game.wave);
  game.spawning = 0.35;
  floater(`WAVE ${game.wave}`, window.innerWidth / 2, window.innerHeight * 0.22, "");
}

function spawnNext() {
  const kind = game.leftToSpawn.shift();
  if (!kind) return;
  if (!robotTemplate) {
    game.leftToSpawn.unshift(kind);
    game.spawning = 0.3;
    return;
  }
  flatForward();
  const placed = enemies.filter((e) => !e.ko).length;
  const total = placed + game.leftToSpawn.length + 1;
  const slot = total - game.leftToSpawn.length - 1;
  const spread = (slot - (total - 1) / 2) * 0.9;
  playerXZ();
  let x;
  let z;
  if (game.xr && game.placed) {
    const dist = 0.45 + (slot % 3) * 0.22;
    x = anchor.x + tmp.fwd.x * dist + tmp.right.x * spread * 0.45;
    z = anchor.z + tmp.fwd.z * dist + tmp.right.z * spread * 0.45;
  } else {
    const dist = 4.1 + (slot % 2) * 0.35;
    x = tmp.cam.x + tmp.fwd.x * dist + tmp.right.x * spread;
    z = tmp.cam.z + tmp.fwd.z * dist + tmp.right.z * spread;
  }
  const enemy = makeEnemy(kind, x, z);
  enemy.speed = Math.min(1.55, 0.62 + game.wave * 0.06);
  enemy.attack = Math.max(0.9, 2.15 - game.wave * 0.1);
  if (kind === "fuzz") {
    const prev = [...enemies].reverse().find((e) => e !== enemy && e.kind === "fuzz" && e.alive && !e.linkR);
    if (prev) prev.linkR = enemy;
  }
}

function screenOf(pos) {
  tmp.a.copy(pos).project(camera);
  return {
    x: (tmp.a.x * 0.5 + 0.5) * window.innerWidth,
    y: (-tmp.a.y * 0.5 + 0.5) * window.innerHeight,
    behind: tmp.a.z > 1,
  };
}

function pickTarget(px, py) {
  let best = null;
  let bestScore = Infinity;
  let fallback = null;
  let fallbackScore = Infinity;
  for (const enemy of enemies) {
    if (enemy.ko || enemy.age < 0.2) continue;
    const pt = screenOf(enemy.parts.chest.pos);
    if (pt.behind) continue;
    const d = Math.hypot(pt.x - px, pt.y - py);
    const limit = enemy.alive ? 210 : 140;
    if (d < limit && d < bestScore && (enemy.alive || !best || !best.alive)) {
      if (enemy.alive || !best || best.alive === enemy.alive) {
        best = enemy;
        bestScore = d;
      }
    }
    if (enemy.alive && d < fallbackScore) {
      fallback = enemy;
      fallbackScore = d;
    }
  }
  if (best && best.alive) return best;
  if (fallback && fallbackScore < 260) return fallback;
  return best;
}

function lockedTarget() {
  return pickTarget(window.innerWidth / 2, window.innerHeight * 0.46);
}

function floater(text, x, y, cls) {
  const node = document.createElement("div");
  node.className = `floater ${cls || ""}`;
  node.textContent = text;
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  $("floaters").appendChild(node);
  setTimeout(() => node.remove(), 720);
}

function bumpCombo() {
  game.combo += 1;
  game.comboLeft = 1.45;
  comboEl.textContent = game.combo > 1 ? `${game.combo} HIT` : "";
  comboEl.classList.remove("pop");
  void comboEl.offsetWidth;
  comboEl.classList.add("pop");
}

function awardKo(enemy) {
  if (enemy.ko) return;
  enemy.ko = true;
  enemy.removeIn = 2.4;
  game.kos += 1;
  koCount.textContent = String(game.kos);
  const best = Number(localStorage.getItem(BEST_KEY) || 0);
  if (game.kos > best) localStorage.setItem(BEST_KEY, String(game.kos));
  const pt = screenOf(enemy.parts.head.pos);
  floater("KO", pt.behind ? window.innerWidth / 2 : pt.x, pt.behind ? window.innerHeight / 2 : pt.y, "ko");
  audio.ko();
  if (navigator.vibrate) navigator.vibrate(28);
}

function strike(type, hookSign, clientX, clientY) {
  if (game.over || game.mode !== "play") return;
  if (punch.active && punch.t < 0.48) return;
  audio.ensure();
  punch.active = true;
  punch.t = 0;
  punch.type = type;
  punch.hook = hookSign || 1;
  punch.didHit = false;
  const target = pickTarget(clientX, clientY) || lockedTarget();
  punch.target = target && !target.ko ? target : null;
  if (type === "upper") audio.upper();
  else if (type === "hook") audio.hook();
  else audio.jab();
  game.shake = Math.max(game.shake, 0.12);
}

function resolveHit() {
  const target = punch.target;
  if (!target || target.ko) return;
  camera.getWorldDirection(tmp.fwd);
  const flat = tmp.a.copy(tmp.fwd);
  flat.y = 0;
  if (flat.lengthSq() < 0.001) flat.set(0, 0, -1);
  flat.normalize();
  tmp.right.crossVectors(flat, tmp.up).normalize();
  let power = 7;
  let lift = 2.4;
  const dir = tmp.b.copy(flat);
  if (punch.type === "hook") {
    dir.addScaledVector(tmp.right, punch.hook * 0.9).normalize();
    power = 9.5;
    lift = 3.2;
  } else if (punch.type === "upper") {
    dir.multiplyScalar(0.25).add(tmp.c.set(0, 1, 0)).normalize();
    power = 5.5;
    lift = 13;
  }
  const fresh = launchEnemy(target, dir, power, lift);
  const words = punch.type === "upper" ? ["UP", "YEET", "BOOM"] : punch.type === "hook" ? ["WHAM", "CRACK", "POW"] : ["BAM", "POW", "JAB"];
  const pt = screenOf(target.parts.chest.pos);
  floater(words[Math.floor(Math.random() * words.length)], pt.x, pt.y, "");
  burst(target.parts.chest.pos, punch.type === "upper" ? 0xfff3c4 : 0xffb15a, 10, 4.5, punch.type === "upper" ? 1.6 : 0.8);
  if (punch.type === "upper") burst(target.parts.head.pos, 0xfff7d6, 8, 2.2, 2.4);
  shock(target.parts.hips.pos);
  flashEl.classList.remove("on");
  void flashEl.offsetWidth;
  flashEl.classList.add("on");
  game.shake = Math.max(game.shake, punch.type === "upper" ? 0.7 : 0.45);
  bumpCombo();
  if (fresh) awardKo(target);
  if (navigator.vibrate) navigator.vibrate(16);
  fist.scale.setScalar(1.12);
}

function updatePunch(dt, time) {
  if (punch.active) {
    punch.t += dt / (punch.type === "upper" ? 0.42 : 0.3);
    if (!punch.didHit && punch.t > 0.16 && punch.t < 0.4) {
      punch.didHit = true;
      if (punch.target) resolveHit();
    }
    if (punch.t >= 1) punch.active = false;
  }
  const extend = punch.active ? punchCurve(Math.min(punch.t, 1)) : 0;
  const aim = tmp.a.set(0, 0.02, -1);
  if (punch.active && punch.target) {
    camera.updateMatrixWorld(true);
    tmp.b.copy(punch.target.parts.chest.pos);
    camera.worldToLocal(tmp.b);
    aim.copy(tmp.b).sub(punch.rest);
    if (aim.lengthSq() < 0.01) aim.set(0, 0, -1);
  } else if (punch.active && punch.type === "upper") {
    aim.set(0, 0.7, -1);
  } else if (punch.active && punch.type === "hook") {
    aim.set(punch.hook * 0.55, 0.05, -1);
  }
  aim.normalize();
  const reach = punch.type === "jab" ? 0.72 : 0.86;
  fist.position.copy(punch.rest).addScaledVector(aim, extend * reach);
  fist.position.y += Math.sin(time * 2.4) * 0.012;
  const squash = 1 + extend * 0.12;
  fist.scale.setScalar(squash);
}

function updateEnemies(dt, time) {
  playerXZ();
  const px = tmp.cam.x;
  const pz = tmp.cam.z;
  for (const enemy of enemies) {
    enemy.age += dt;
    enemy.flash = Math.max(0, enemy.flash - dt);
    if (!enemy.dynamic) {
      const dx = px - enemy.root.x;
      const dz = pz - enemy.root.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      enemy.yaw = Math.atan2(dx, dz);
      const reach = game.xr ? 1.35 : 2.45;
      if (dist > reach) {
        const step = Math.min(dist - reach, enemy.speed * dt);
        enemy.root.x += (dx / dist) * step;
        enemy.root.z += (dz / dist) * step;
      } else if (!game.over) {
        enemy.attack -= dt;
        if (enemy.attack <= 0) {
          enemy.attack = Math.max(0.85, 1.7 - game.wave * 0.08);
          enemy.lunge = 0.34;
        }
      }
      if (enemy.lunge > 0) {
        enemy.lunge -= dt;
        enemy.root.x += (dx / dist) * 4.2 * dt;
        enemy.root.z += (dz / dist) * 4.2 * dt;
        if (enemy.lunge < 0.2 && dist < 1.45 && game.invuln <= 0 && !game.over) {
          game.hearts -= 1;
          game.invuln = 0.9;
          game.shake = 0.8;
          audio.hurt();
          hurtEl.classList.remove("on");
          void hurtEl.offsetWidth;
          hurtEl.classList.add("on");
          if (navigator.vibrate) navigator.vibrate(40);
          enemy.root.x = px - (dx / dist) * 2.4;
          enemy.root.z = pz - (dz / dist) * 2.4;
          renderHearts();
          if (game.hearts <= 0) endGame();
        }
      }
      layoutEnemy(enemy);
    } else {
      integrateEnemy(enemy, dt);
      const speed = enemy.vel.length();
      const hips = enemy.parts.hips.pos;
      const away = Math.hypot(hips.x - px, hips.z - pz);
      if (enemy.lift < 0.15 && speed < 1.3) enemy.settle += dt;
      else enemy.settle = 0;
      if (punch.type === "upper" && enemy.flash > 0) {
        burst(enemy.parts.head.pos, 0xffe7a8, 1, 0.4, 1);
      }
      if (away < 1.2) {
        const push = tmp.a.set(hips.x - px, 0, hips.z - pz);
        if (push.lengthSq() < 0.0001) push.set(0, 0, -1);
        push.normalize().multiplyScalar(6);
        enemy.vel.add(push);
      }
      if (enemy.ko && (enemy.settle > 0.7 || away > 11 || hips.y > game.floorY + 8 || enemy.age > 8)) {
        enemy.removeIn = Math.min(enemy.removeIn || 0.4, 0.35);
      }
    }
    syncEnemy(enemy, dt);
    if (enemy.removeIn > 0) enemy.removeIn -= dt;
  }
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies[i].removeIn < 0) {
      disposeEnemy(enemies[i]);
      enemies.splice(i, 1);
    }
  }
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      const a = enemies[i];
      const b = enemies[j];
      if (a.dynamic || b.dynamic) continue;
      const dx = b.root.x - a.root.x;
      const dz = b.root.z - a.root.z;
      const d = Math.hypot(dx, dz) || 0.001;
      if (d < 0.72) {
        const push = (0.72 - d) * 0.5;
        a.root.x -= (dx / d) * push;
        a.root.z -= (dz / d) * push;
        b.root.x += (dx / d) * push;
        b.root.z += (dz / d) * push;
      }
    }
  }
}

function updateHud(dt) {
  game.comboLeft -= dt;
  if (game.comboLeft <= 0) {
    game.combo = 0;
    comboEl.textContent = "";
  }
  const target = lockedTarget();
  if (target && !target.ko) {
    const pt = screenOf(target.parts.chest.pos);
    reticle.classList.add("on");
    reticle.style.left = `${pt.x}px`;
    reticle.style.top = `${pt.y}px`;
  } else {
    reticle.classList.remove("on");
  }
  if (game.shake > 0) {
    game.shake = Math.max(0, game.shake - dt * 2.4);
    const mag = game.shake * 16;
    document.body.style.transform = `translate(${(Math.random() - 0.5) * mag}px, ${(Math.random() - 0.5) * mag}px)`;
  } else {
    document.body.style.transform = "";
  }
}

function drawCoach(pointer) {
  const w = fxCanvas.width;
  const h = fxCanvas.height;
  fxCtx.clearRect(0, 0, w, h);
  if (game.mode !== "play" || game.over) return;
  if (pointer) {
    fxCtx.strokeStyle = "#1a140f";
    fxCtx.lineWidth = 8;
    fxCtx.lineCap = "round";
    fxCtx.beginPath();
    fxCtx.moveTo(pointer.x0, pointer.y0);
    const cx = (pointer.x0 + pointer.x) / 2 + (pointer.y0 - pointer.y) * 0.15;
    const cy = Math.min(pointer.y0, pointer.y) - 30;
    fxCtx.quadraticCurveTo(cx, cy, pointer.x, pointer.y);
    fxCtx.stroke();
    return;
  }
  if (game.kos > 0 || game.wave > 1) return;
  const cx = w * 0.5;
  const cy = h * 0.72;
  fxCtx.strokeStyle = "rgba(26,20,15,0.85)";
  fxCtx.lineWidth = 7;
  fxCtx.beginPath();
  fxCtx.arc(cx, cy, 54, Math.PI * 1.05, Math.PI * 1.95);
  fxCtx.stroke();
}

let pointer = null;

function classify(dx, dy) {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (ady > 46 && ady > adx * 1.05 && dy < 0) return { type: "upper", hook: 1 };
  if (adx > 40 && adx > ady) return { type: "hook", hook: Math.sign(dx) || 1 };
  return { type: "jab", hook: Math.sign(dx) || 1 };
}

playfield.addEventListener("pointerdown", (event) => {
  if (game.mode !== "play" || game.over) return;
  pointer = { x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY, t: performance.now() };
  playfield.setPointerCapture(event.pointerId);
});
playfield.addEventListener("pointermove", (event) => {
  if (!pointer) return;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
});
playfield.addEventListener("pointerup", (event) => {
  if (game.mode === "place") {
    confirmPlacement();
    pointer = null;
    return;
  }
  if (!pointer) return;
  const dx = event.clientX - pointer.x0;
  const dy = event.clientY - pointer.y0;
  const move = classify(dx, dy);
  const quick = performance.now() - pointer.t < 280 && Math.hypot(dx, dy) < 22;
  const punchType = quick ? { type: "jab", hook: 1 } : move;
  strike(punchType.type, punchType.hook, event.clientX, event.clientY);
  pointer = null;
});
playfield.addEventListener("pointercancel", () => { pointer = null; });

window.addEventListener("keydown", (event) => {
  if (game.mode !== "play") return;
  const x = window.innerWidth / 2;
  const y = window.innerHeight * 0.45;
  if (event.key === "j" || event.key === "J") strike("jab", 1, x, y);
  if (event.key === "h" || event.key === "H") strike("hook", 1, x + 80, y);
  if (event.key === "u" || event.key === "U") strike("upper", 1, x, y - 80);
});

function renderHearts() {
  heartsEl.innerHTML = [0, 1, 2].map((i) => `<i class="${i < game.hearts ? "on" : ""}">♥</i>`).join("");
}

function endGame() {
  game.over = true;
  const best = Math.max(game.kos, Number(localStorage.getItem(BEST_KEY) || 0));
  $("over-title").textContent = game.kos ? `${game.kos} KO` : "Down";
  $("over-copy").textContent = `Best ${best}. The room is still standing.`;
  $("over").classList.add("show");
  reticle.classList.remove("on");
}

function resetMatch() {
  for (const enemy of enemies) disposeEnemy(enemy);
  enemies.length = 0;
  game.kos = 0;
  game.hearts = 3;
  game.combo = 0;
  game.comboLeft = 0;
  game.wave = 1;
  game.over = false;
  game.invuln = 0;
  game.spawning = 0;
  game.leftToSpawn = [];
  koCount.textContent = "0";
  comboEl.textContent = "";
  renderHearts();
  $("over").classList.remove("show");
  beginWave();
}

function syncViewRig() {
  if (!renderer.xr.isPresenting) return;
  const xrCam = renderer.xr.getCamera();
  const view = xrCam.cameras && xrCam.cameras.length ? xrCam.cameras[0] : xrCam;
  rig.position.copy(view.position);
  rig.quaternion.copy(view.quaternion);
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
  camera.projectionMatrix.copy(view.projectionMatrix);
  camera.projectionMatrixInverse.copy(view.projectionMatrixInverse);
  rig.updateMatrixWorld(true);
}

const planeMeshes = new Map();

function updateDetectedPlanes(frame) {
  if (!frame || !frame.detectedPlanes || !renderer.xr.isPresenting) return;
  const referenceSpace = renderer.xr.getReferenceSpace();
  if (!referenceSpace) return;
  const seen = new Set();
  for (const plane of frame.detectedPlanes) {
    seen.add(plane);
    const mesh = planeMeshes.get(plane);
    const horizontal = !plane.orientation || plane.orientation === "horizontal";
    if (!horizontal) {
      if (mesh) mesh.visible = false;
      continue;
    }
    const pose = frame.getPose(plane.planeSpace, referenceSpace);
    if (!pose) continue;
    let entry = mesh;
    if (!entry) {
      entry = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({
          color: 0x7dffb3,
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      entry.matrixAutoUpdate = false;
      entry.renderOrder = 1;
      scene.add(entry);
      planeMeshes.set(plane, entry);
    }
    const positions = [];
    const indices = [];
    let index = 0;
    for (const point of plane.polygon) {
      positions.push(point.x, point.y, point.z);
      if (index >= 2) indices.push(0, index - 1, index);
      index += 1;
    }
    entry.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    entry.geometry.setIndex(indices);
    entry.matrix.fromArray(pose.transform.matrix);
    entry.visible = game.mode === "place";
  }
  for (const [plane, mesh] of planeMeshes) {
    if (seen.has(plane)) continue;
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    planeMeshes.delete(plane);
  }
}

function clearPlanes() {
  for (const mesh of planeMeshes.values()) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  planeMeshes.clear();
}

function updateFloorHit(xrFrame) {
  if (!xrFrame || !hitTestSource || game.placed) {
    if (game.placed) placeReticle.visible = false;
    return;
  }
  const referenceSpace = renderer.xr.getReferenceSpace();
  if (!referenceSpace) return;
  const hits = xrFrame.getHitTestResults(hitTestSource);
  game.hitReady = false;
  for (const hit of hits) {
    const pose = hit.getPose(referenceSpace);
    if (!pose) continue;
    hitMatrix.fromArray(pose.transform.matrix);
    hitNormal.set(0, 1, 0).transformDirection(hitMatrix);
    if (hitNormal.y < 0.72) continue;
    placeReticle.matrix.copy(hitMatrix);
    placeReticle.visible = true;
    game.hitReady = true;
    $("place-hint").innerHTML = "Floor found<br>Tap to place the ring";
    return;
  }
  placeReticle.visible = false;
  $("place-hint").innerHTML = "Look at the floor<br>Tap to place the ring";
}

function confirmPlacement() {
  if (!game.hitReady || game.placed) return;
  anchor.setFromMatrixPosition(hitMatrix);
  game.floorY = anchor.y;
  game.placed = true;
  game.mode = "play";
  placeReticle.visible = false;
  spot.position.set(anchor.x, anchor.y + 0.015, anchor.z);
  spot.visible = true;
  $("place-hint").hidden = true;
  $("hint").hidden = false;
  resetMatch();
}

function moveRing() {
  game.placed = false;
  game.hitReady = false;
  game.mode = "place";
  game.floorY = 0;
  spot.visible = false;
  placeReticle.visible = false;
  for (const enemy of enemies) disposeEnemy(enemy);
  enemies.length = 0;
  game.leftToSpawn = [];
  game.over = false;
  $("over").classList.remove("show");
  $("place-hint").hidden = false;
  $("hint").hidden = true;
  $("place-hint").innerHTML = "Look at the floor<br>Tap to place the ring";
}

function onXREnd() {
  hitTestSource = null;
  game.xr = false;
  game.ar = false;
  game.placed = true;
  game.floorY = 0;
  game.mode = "boot";
  game.hitReady = false;
  spot.visible = false;
  placeReticle.visible = false;
  clearPlanes();
  for (const enemy of enemies) disposeEnemy(enemy);
  enemies.length = 0;
  rig.position.set(0, 1.55, 0);
  rig.quaternion.identity();
  rig.rotation.set(-0.22, 0, 0);
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
  $("boot").classList.remove("hide");
  $("hud").hidden = true;
  $("place-hint").hidden = true;
  $("over").classList.remove("show");
  video.classList.remove("on");
  floor.visible = true;
  sky.visible = true;
  stars.visible = true;
  document.body.style.background = "#8fd8ea";
}

async function requestARSession() {
  const depthSensing = {
    usagePreference: ["gpu-optimized", "cpu-optimized"],
    dataFormatPreference: ["luminance-alpha", "float32"],
  };
  const attempts = [
    {
      requiredFeatures: ["hit-test", "local-floor", "plane-detection", "depth-sensing", "dom-overlay"],
      domOverlay: { root: $("ui") },
      depthSensing,
    },
    {
      requiredFeatures: ["hit-test", "local-floor", "plane-detection", "depth-sensing"],
      depthSensing,
    },
    {
      requiredFeatures: ["hit-test", "local-floor", "plane-detection", "dom-overlay"],
      domOverlay: { root: $("ui") },
    },
    { requiredFeatures: ["hit-test", "local-floor", "plane-detection"] },
    {
      requiredFeatures: ["hit-test", "local-floor", "dom-overlay"],
      domOverlay: { root: $("ui") },
    },
    { requiredFeatures: ["hit-test", "local-floor"] },
  ];
  let lastError = null;
  for (const options of attempts) {
    try {
      return await navigator.xr.requestSession("immersive-ar", options);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("ARCore didn't start.");
}

async function startARCore() {
  if (!navigator.xr || typeof navigator.xr.isSessionSupported !== "function") {
    throw new Error("This browser has no AR session. Floor placement needs ARCore in Chrome on Android.");
  }
  if (!(await navigator.xr.isSessionSupported("immersive-ar"))) {
    throw new Error("ARCore isn't available. Open this https link in Chrome on an Android phone with ARCore.");
  }
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local-floor");
  const session = await requestARSession();
  session.addEventListener("end", onXREnd);
  await renderer.xr.setSession(session);
  const viewerSpace = await session.requestReferenceSpace("viewer");
  try {
    hitTestSource = await session.requestHitTestSource({ space: viewerSpace, entityTypes: ["plane"] });
  } catch {
    hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  }
  const feats = session.enabledFeatures || [];
  game.planesOn = feats.includes("plane-detection");
  game.depthOn = feats.includes("depth-sensing");
}

function setArena(ar) {
  game.ar = ar;
  video.classList.toggle("on", false);
  floor.visible = !ar;
  sky.visible = !ar;
  stars.visible = !ar;
  document.body.style.background = ar ? "#111" : "#8fd8ea";
}

async function start(wantAr) {
  audio.ensure();
  try {
    await assetsReady;
  } catch {
    return;
  }
  if (!wantAr) {
    game.xr = false;
    game.placed = true;
    game.floorY = 0;
    spot.visible = false;
    $("boot").classList.add("hide");
    $("hud").hidden = false;
    $("place-hint").hidden = true;
    $("hint").hidden = false;
    $("recenter").hidden = true;
    renderHearts();
    setArena(false);
    rig.quaternion.identity();
    rig.position.set(0, 1.55, 0);
    rig.rotation.set(-0.22, 0, 0);
    game.mode = "play";
    resetMatch();
    return;
  }
  try {
    await startARCore();
  } catch (err) {
    $("boot-note").textContent = err && err.message ? err.message : "ARCore didn't start. Use Chrome on Android.";
    return;
  }
  game.xr = true;
  game.ar = true;
  game.placed = false;
  game.hitReady = false;
  game.floorY = 0;
  $("boot").classList.add("hide");
  $("hud").hidden = false;
  $("place-hint").hidden = false;
  $("place-hint").innerHTML = game.planesOn
    ? "Green shapes are detected floor<br>Tap to place the ring"
    : "Look at the floor<br>Tap to place the ring";
  if (game.depthOn) $("place-hint").innerHTML += "<br>Real objects block the fighters";
  $("hint").hidden = true;
  $("recenter").hidden = false;
  $("recenter").textContent = "Move ring";
  renderHearts();
  setArena(true);
  video.classList.remove("on");
  game.mode = "place";
}

$("go-ar").addEventListener("click", () => start(true));
$("go-demo").addEventListener("click", () => start(false));
$("retry").addEventListener("click", () => {
  audio.ensure();
  resetMatch();
});
$("recenter").addEventListener("pointerdown", (event) => {
  event.stopPropagation();
  event.preventDefault();
  if (game.xr) moveRing();
  else recenter();
});
$("sound").addEventListener("click", () => {
  game.muted = !game.muted;
  $("sound").textContent = game.muted ? "Sound off" : "Sound on";
  if (!game.muted) audio.ensure();
});

let robotTemplate = null;
const clips = {};

function mirrorMeshOnto(fromMesh, toMesh) {
  const src = fromMesh.geometry.attributes.position;
  const dst = toMesh.geometry.attributes.position;
  if (!src || !dst || src.count !== dst.count) return;
  for (let i = 0; i < src.count; i++) {
    dst.setXYZ(i, -src.getX(i), src.getY(i), src.getZ(i));
  }
  dst.needsUpdate = true;
  const srcNormal = fromMesh.geometry.attributes.normal;
  const dstNormal = toMesh.geometry.attributes.normal;
  if (srcNormal && dstNormal && srcNormal.count === dstNormal.count) {
    for (let i = 0; i < srcNormal.count; i++) {
      dstNormal.setXYZ(i, -srcNormal.getX(i), srcNormal.getY(i), srcNormal.getZ(i));
    }
    dstNormal.needsUpdate = true;
  }
  toMesh.geometry.computeBoundingBox();
  toMesh.geometry.computeBoundingSphere();
}

function meshSpan(mesh) {
  mesh.geometry.computeBoundingBox();
  const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z);
}

function repairRobotArms(root) {
  const meshes = [];
  root.traverse((obj) => {
    if (obj.isMesh) meshes.push(obj);
  });
  const groups = new Map();
  for (const mesh of meshes) {
    const count = mesh.geometry.attributes.position.count;
    if (!groups.has(count)) groups.set(count, []);
    groups.get(count).push(mesh);
  }
  for (const list of groups.values()) {
    const sane = list.filter((mesh) => meshSpan(mesh) < 20);
    const broken = list.filter((mesh) => meshSpan(mesh) >= 20);
    if (sane.length === 1 && broken.length === 1) mirrorMeshOnto(sane[0], broken[0]);
  }
}

function loadAssets() {
  const loader = new GLTFLoader();
  return loader.loadAsync("./models/robot.glb").then((robotGltf) => {
    repairRobotArms(robotGltf.scene);
    robotTemplate = robotGltf.scene;
    for (const clip of robotGltf.animations) {
      if (clip.name.endsWith("|Walk")) clips.walk = clip;
      if (clip.name.endsWith("|Die")) clips.die = clip;
    }
  });
}

const assetsReady = loadAssets().catch((err) => {
  console.error(err);
  $("boot-note").textContent = "The glove or robot model didn't load.";
  throw err;
});

let last = performance.now();
let startedLoop = false;

function frame(now, xrFrame) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  const time = now / 1000;
  syncViewRig();
  if (xrFrame) updateDetectedPlanes(xrFrame);
  if (game.mode === "place") updateFloorHit(xrFrame);
  rig.updateMatrixWorld(true);
  if (game.mode === "play" && !game.over && game.placed) {
    game.invuln = Math.max(0, game.invuln - dt);
    if (game.leftToSpawn.length) {
      game.spawning -= dt;
      if (game.spawning <= 0) {
        spawnNext();
        game.spawning = 0.42;
      }
    } else if (enemies.every((e) => e.ko || e.dynamic)) {
      game.wave += 1;
      beginWave();
    }
    updatePunch(dt, time);
    updateEnemies(dt, time);
  } else if (game.mode === "play") {
    updatePunch(dt, time);
    updateEnemies(dt, time);
  }
  for (const spark of sparks) {
    if (spark.life <= 0) continue;
    spark.life -= dt;
    spark.mesh.position.addScaledVector(spark.vel, dt);
    spark.vel.y -= 4 * dt;
    spark.mesh.quaternion.copy(camera.quaternion);
    spark.mesh.material.opacity = Math.max(0, spark.life * 2.4);
    const s = 0.4 + (0.4 - spark.life) * 1.6;
    spark.mesh.scale.setScalar(Math.max(0.2, s));
    if (spark.life <= 0) spark.mesh.visible = false;
  }
  if (ringLife > 0) {
    ringLife -= dt;
    ring.scale.setScalar(0.4 + (0.28 - ringLife) * 7);
    ring.material.opacity = Math.max(0, ringLife * 3);
    if (ringLife <= 0) ring.visible = false;
  }
  if (game.mode === "play") updateHud(dt);
  drawCoach(pointer);
  rig.updateMatrixWorld(true);
  renderer.render(scene, camera);
}

if (!startedLoop) {
  startedLoop = true;
  renderer.setAnimationLoop(frame);
}

if (!window.isSecureContext) {
  $("boot-note").textContent = "Floor placement needs the https link in Chrome on Android so ARCore can see the floor.";
}
