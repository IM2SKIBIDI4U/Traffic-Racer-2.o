import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { applyCameraMode } from './camera-modes.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const scene = new THREE.Scene();
const dayColor = new THREE.Color(0x9bbdd0);
const nightColor = new THREE.Color(0x071321);
scene.background = dayColor;
scene.fog = new THREE.Fog(dayColor, 55, 250);
// Set camera far clipping plane to 400 (instead of 180 or 200)
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 400);
// Match fog so distant cars fade in smoothly instead of popping
scene.fog = new THREE.Fog(0x0b1624, 140, 340);
camera.position.set(0, 5.5, 15);
camera.lookAt(0, 1, -22);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
} catch {
  document.body.innerHTML = '<p style="padding:2rem;color:white;font:16px sans-serif">This game needs a current browser with WebGL enabled.</p>';
  throw new Error('WebGL is unavailable');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 0.85));
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;

const hemi = new THREE.HemisphereLight(0xd8efff, 0x455448, 1.45);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe6c6, 2.2);
sun.position.set(-18, 30, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -22;
sun.shadow.camera.right = 22;
sun.shadow.camera.top = 28;
sun.shadow.camera.bottom = -22;
scene.add(sun);

const clock = new THREE.Clock();
const roads = [];
const scenery = [];
const grounds = [];
const traffic = [];
const trafficVehicles = [];
let activeTrafficVehicles = null;
const particles = [];
const lanes = [-6.75, -2.25, 2.25, 6.75];
const keys = { left: false, right: false, accelerate: false, brake: false, drift: false, nitro: false };
const cars = [
  { id: 'starter', name: 'LEXUS LS 500H', color: 0x1678c8, cost: 0, maxSpeed: 190, acceleration: 25, handling: 8.3, modelStyle: 0 },
  { id: 'rally', name: 'RALLY GT', color: 0xd54b3e, cost: 250, maxSpeed: 205, acceleration: 34, handling: 9.2, modelStyle: 1 },
  { id: 'midnight', name: 'MIDNIGHT SUV', color: 0x403f70, cost: 650, maxSpeed: 225, acceleration: 27, handling: 7.8, modelStyle: 2 },
  { id: 'sunset', name: 'SUNSET COUPE', color: 0xe9a33b, cost: 1100, maxSpeed: 195, acceleration: 39, handling: 10.2, modelStyle: 1 },
  { id: 'emerald', name: 'EMERALD SUV', color: 0x328260, cost: 1700, maxSpeed: 240, acceleration: 31, handling: 8.5, modelStyle: 2 },
  { id: 'silver', name: 'SILVERLINE VAN', color: 0xb8c3c6, cost: 2600, maxSpeed: 260, acceleration: 36, handling: 9.0, modelStyle: 3 },
];

function load(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* Storage may be disabled. */ }
}

const storedCredits = Number(load('tr-credits', '0'));
let credits = Number.isFinite(storedCredits) ? Math.max(0, Math.floor(storedCredits)) : 0;
let owned;
try {
  const storedOwned = JSON.parse(load('tr-owned', '["starter"]'));
  owned = new Set(Array.isArray(storedOwned) ? storedOwned.filter((id) => cars.some((car) => car.id === id)) : []);
} catch { owned = new Set(); }
owned.add('starter');
let selectedCar = load('tr-car', 'starter');
if (!owned.has(selectedCar) || !cars.some((car) => car.id === selectedCar)) selectedCar = 'starter';
const roadMode = 'one-way';
let autoAccel = load('tr-auto', 'true') !== 'false';
let soundEnabled = load('tr-sound', 'true') !== 'false';
let night = load('tr-night', 'false') === 'true';

let player;
let playerLateral = lanes.at(2);
let cityDriving = false;
let running = false;
let paused = false;
let score = 0;
let actualSpeed = 0;
let steerVelocity = 0;
let nitro = 100;
let nitroActive = false;
let spawnTimer = 0.8;
let burstTimer = 0;
let burstCooldown = 9;
let cameraShake = 0;
let audioContext;
let engineOscillator;
let engineGain;
let engineFilter;
let nearMissChain = 0;
let hitCooldown = 0;
let playerHealth = 100;
let takedownCharge = 0;
let takedownHud = null;
let collisionRecoil = 0;
let collisionYaw = 0;
let collisionAngularVelocity = 0;
let collisionHeading = 0;
let gameMode = 'escape'; // This build has one mode: escape the police.
let policeChasers = [];
let repairPickups = [];
let cityRoot = null;
let cityBuildingGrid = new Map();
let cityTraffic = [];
let cityPolice = [];
let cityRepairPickups = [];
let cityRepairTimer = 3;
let cityDistance = 0;
let citySpeedMps = 0;
let cityHeading = 0;
let cityWorldReady = false;
const CITY_BLOCK = 90;
const CITY_HALF = 630;
let dragRaceActive = false;
let dragRaceTime = 0;
let dragRaceHud = null;
let dragRaceOpponent = null;
let dragRaceOpponentSpeed = 0;
let cityWantedLevel = 0;
let cityLawbreakingTime = 0;
let cityPoliceSpawnTimer = 0;
let cityOnFoot = false;
let cityAvatar = null;
let cityParkedCar = null;
let cityFootHeading = 0;
let cityCrimeHud = null;
const cityRaceMarkers = [{x:0,z:-520,label:'DRAG START'},{x:0,z:-220,label:'DRAG FINISH'}];
const cityBusinessLocations = [{x:180,z:180,name:'CORNER STORE'},{x:-270,z:90,name:'JEWELRY SHOP'},{x:360,z:-270,name:'BANK'}];

let repairSpawnTimer = 5;
let policeCatchTime = 0;
let escapeProgress = 0;
let arrests = 0;
let weatherMode = load('tr-weather', 'clear');
let weatherClock = 0;
let dayCycleClock = 0;
let weatherParticles = null;
let locationIndex = Number(load('tr-location','0')) || 0;
let upgradeLevels;
try { upgradeLevels = JSON.parse(load('tr-upgrades','{"engine":0,"handling":0,"brakes":0}')); }
catch { upgradeLevels = {engine:0,handling:0,brakes:0}; }
upgradeLevels = {engine:Math.min(5,Math.max(0,upgradeLevels.engine||0)),handling:Math.min(5,Math.max(0,upgradeLevels.handling||0)),brakes:Math.min(5,Math.max(0,upgradeLevels.brakes||0))};
let lastAchievementScore = 0;
let dailyDate = new Date().toISOString().slice(0,10);
let dailyProgress = 0;
let dailyClaimed = load('tr-daily-claimed','') === dailyDate;
function refreshDailyDate() {
  const today = new Date().toISOString().slice(0,10);
  if (today !== dailyDate) {
    dailyDate = today;
    dailyClaimed = load('tr-daily-claimed','') === dailyDate;
    dailyProgress = 0;
    save('tr-daily-progress','0');
    save('tr-daily-progress-date',dailyDate);
  }
}
let unlockedAchievements;
try { unlockedAchievements = new Set(JSON.parse(load('tr-achievements','[]'))); } catch { unlockedAchievements = new Set(); }
const locationThemes = [
  {name:'COUNTRYSIDE',sky:0x9bbdd0,fog:0x9bbdd0,ground:0x607a5d},
  {name:'DESERT HIGHWAY',sky:0xd6a77e,fog:0xc69b79,ground:0x9a8059},
  {name:'MOUNTAIN PASS',sky:0x91aabd,fog:0x91aabd,ground:0x586b68}
];

const material = (color, roughness = 0.65, metalness = 0.05, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

function makeAsphalt() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#303943';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2800; i++) {
    const s = 45 + Math.random() * 40;
    ctx.fillStyle = 'rgba(' + s + ',' + (s + 3) + ',' + (s + 7) + ',.12)';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 1);
  }
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 3);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const asphalt = makeAsphalt();
const roadMat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.94 });
const whiteLine = material(0xe4e1d3, 0.82);
const yellowLine = material(0xf0c94a, 0.8);
const grassMat = material(0x607a5d, 1);

// The road follows a continuous centerline. Positive lateral values are to the right.
function roadCenterX(z) {
  return 0;
}
function roadHeading(z) {
  return 0;
}
function placeOnRoad(object, lateral, z, headingOffset = 0) {
  object.userData.roadZ = z;
  const heading = roadHeading(z);
  object.position.x = roadCenterX(z) + lateral * Math.cos(heading);
  object.position.z = z - lateral * Math.sin(heading);
  object.rotation.y = heading + headingOffset;
}

function createRoad(z, length = roadSegmentLength) {
  const group = new THREE.Group();
  const roadDepth = length;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(18, 0.22, roadDepth), roadMat);
  slab.position.y = -0.02;
  slab.receiveShadow = true;
  group.add(slab);
  for (const x of [-9, 9]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.04, roadDepth), whiteLine);
    edge.position.set(x, 0.105, 0);
    group.add(edge);
  }
  for (const x of [-4.5, 0, 4.5]) {
    if (roadMode === 'two-way' && x === 0) {
      for (const offset of [-0.12, 0.12]) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, roadDepth), yellowLine);
        line.position.set(offset, 0.11, 0);
        group.add(line);
      }
    } else {
      for (let dz = -length / 2 + 2; dz < length / 2; dz += 8) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 3.8), whiteLine);
        dash.position.set(x, 0.11, dz);
        group.add(dash);
      }
    }
  }
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, roadDepth), material(0x8c9290, 0.9));
    shoulder.position.set(side * 10.5, -0.06, 0);
    group.add(shoulder);
  }
  group.userData.roadStation = z;
  placeOnRoad(group, 0, z);
  scene.add(group);
  roads.push(group);
}

function createCar(color, isPlayer = false, style = 0) {
  const group = new THREE.Group();
  const paint = material(color, 0.28, 0.42, { clearcoat: 0.65, clearcoatRoughness: 0.2 });
  const glass = material(0x162a35, 0.2, 0.25, { metalness: 0.2, roughness: 0.18 });
  const rubber = material(0x111417, 0.92);
  const rim = material(0x9ba9ad, 0.28, 0.75);
  const width = style === 2 || style === 3 ? 2.08 : style === 1 ? 1.82 : 1.88;
  const length = style === 3 ? 5.1 : style === 2 ? 4.8 : style === 1 ? 4.5 : 4.25;
  const lower = new THREE.Mesh(
    style === 3
      ? new THREE.BoxGeometry(width * 0.9, 0.78, length * 0.92)
      : new THREE.CapsuleGeometry(width * 0.44, length * (style === 1 ? 0.82 : 0.72), 4, 12),
    paint
  );
  if (style !== 3) {
    lower.rotation.x = Math.PI / 2;
    lower.scale.set(1, 1, style === 1 ? 0.32 : 0.37);
  }
  lower.position.y = style === 3 ? 0.7 : style === 2 ? 0.72 : 0.64;
  lower.castShadow = true;
  group.add(lower);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), paint);
  hood.scale.set(width * 0.48, style === 2 ? 0.23 : 0.18, style === 3 ? 0.62 : style === 1 ? 0.65 : 0.73);
  hood.position.set(0, style === 2 ? 1 : 0.92, length * (style === 3 ? 0.34 : 0.32));
  group.add(hood);
  const cabin = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), glass);
  cabin.scale.set(
    width * (style === 1 ? 0.35 : 0.37),
    style === 2 || style === 3 ? 0.47 : style === 1 ? 0.31 : 0.43,
    style === 3 ? 0.62 : style === 1 ? 0.77 : 0.98
  );
  cabin.position.set(0, style === 2 || style === 3 ? 1.22 : style === 1 ? 1.04 : 1.13, style === 3 ? 0.12 : -0.22);
  cabin.castShadow = true;
  group.add(cabin);
  const roof = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), paint);
  roof.scale.set(width * 0.31, style === 2 || style === 3 ? 0.15 : style === 1 ? 0.13 : 0.19, style === 3 ? 0.53 : style === 1 ? 0.48 : 0.62);
  roof.position.set(0, style === 2 || style === 3 ? 1.69 : style === 1 ? 1.32 : 1.48, style === 3 ? 0.12 : -0.28);
  group.add(roof);
  if (style === 3) {
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(width * 0.86, 0.78, 1.35), paint);
    cargo.position.set(0, 0.91, -1.28);
    cargo.castShadow = true;
    group.add(cargo);
  }
  const wheelMeshes = [];
  for (const side of [-1, 1]) {
    for (const z of [length * 0.29, -length * 0.31]) {
      const wheel = new THREE.Group();
      wheel.position.set(side * (width * 0.48), 0.4, z);
      const tire = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.12, 9, 16), rubber);
      tire.rotation.y = Math.PI / 2;
      tire.castShadow = true;
      wheel.add(tire);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 16), rim);
      hub.rotation.z = Math.PI / 2;
      wheel.add(hub);
      group.add(wheel);
      wheelMeshes.push(wheel);
    }
  }
  const signalLights = { left: [], right: [] };
  for (const side of [-1, 1]) {
    for (const z of [length * 0.49, -length * 0.49]) {
      const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.055), new THREE.MeshBasicMaterial({ color: 0xffa52f, toneMapped: false }));
      indicator.position.set(side * (width * 0.43), 0.78, z);
      indicator.visible = false;
      group.add(indicator);
      signalLights[side < 0 ? 'left' : 'right'].push(indicator);
    }
  }
  group.userData.turnSignals = signalLights;
  const headlightMat = material(0xfff0cc, 0.25, 0.1, { emissive: 0x67521c });
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), headlightMat);
    head.scale.set(1.2, 0.45, 0.25);
    head.position.set(side * 0.56, 0.76, length * 0.49);
    group.add(head);
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), material(0xd2231a, 0.3, 0.1, { emissive: 0x510805 }));
    tail.scale.set(1.3, 0.5, 0.25);
    tail.position.set(side * 0.55, 0.76, -length * 0.49);
    group.add(tail);
  }
  if (isPlayer) {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.07, 0.18), material(0x151b20, 0.35, 0.4));
    spoiler.position.set(0, 1.15, -1.95);
    group.add(spoiler);
    const underglow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.35, 2.7),
      new THREE.MeshBasicMaterial({ color: 0x38bfff, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
    );
    underglow.rotation.x = -Math.PI / 2;
    underglow.position.y = 0.09;
    group.add(underglow);
  }
  group.userData.paint = paint;
  group.userData.wheels = wheelMeshes;
  group.userData.body = lower;
  group.userData.bodyBaseY = lower.position.y;
  group.userData.modelStyle = style;
  group.userData.collisionHalfWidth = width * 0.52;
  group.userData.collisionHalfLength = length * 0.47;
  group.userData.massKg = style === 3 ? 2250 : style === 2 ? 1850 : style === 1 ? 1450 : 1650;
  return group;
}


function createTrafficVariants() {
  const specs = [
    { color: 0xd9dfe2, style: 3, kind: 'delivery' },
    { color: 0x273b52, style: 2, kind: 'taxi' },
    { color: 0x7b858b, style: 3, kind: 'utility' },
    { color: 0x9b3f32, style: 2, kind: 'roof-rack' },
    { color: 0xe0e0d8, style: 0, kind: 'fleet' }
  ];
  const trim = material(0x9aa6aa, 0.32, 0.72);
  const yellow = material(0xf2c230, 0.5, 0.08);
  for (const spec of specs) {
    const car = createCar(spec.color, false, spec.style);
    car.name = 'procedural_' + spec.kind;
    if (spec.kind === 'delivery') {
      const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.72, 1.12, 1.65), material(0xe4e6e4, 0.82));
      cargo.position.set(0, 1.45, -0.55);
      car.add(cargo);
    } else if (spec.kind === 'taxi') {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.16, 0.28), yellow);
      sign.position.set(0, 1.91, -0.18);
      car.add(sign);
    } else if (spec.kind === 'utility' || spec.kind === 'roof-rack') {
      for (const z of [-0.62, 0.38]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.06, 0.08), trim);
        bar.position.set(0, 1.9, z);
        car.add(bar);
      }
    } else {
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.13, 0.12), trim);
      bumper.position.set(0, 0.48, -2.05);
      car.add(bumper);
    }
    trafficVehicles.push(car);
  }
}

function createPlayer() {
  const spec = cars.find((car) => car.id === selectedCar) || cars.at(0);
  player = createCar(spec.color, true, spec.modelStyle);
  playerLateral = lanes.at(2);
  placeOnRoad(player, playerLateral, 7);
  scene.add(player);
  player.userData.syntheticChildren = [...player.children];
  applyPlayerCar(selectedCar);
  attachPlayerTurnSignals();
  setPlayerPoliceLights(gameMode === 'police');
  const savedPaint=Number(load('tr-custom-paint','0'));
  if(Number.isFinite(savedPaint) && savedPaint>0) applyPlayerPaint(savedPaint);
  const lamp = new THREE.SpotLight(0xe5f5ff, 0, 55, Math.PI / 7, 0.55, 1.5);
  lamp.position.set(0, 1.5, 2.1);
  lamp.target.position.set(0, 0, -32);
  player.add(lamp, lamp.target);
  player.userData.headlamp = lamp;
}

const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
gltfLoader.setDRACOLoader(dracoLoader);

let starterModelPromise;
let startupLoadFinished = false;
let starterLoadFinished = false;
let trafficLoadFinished = false;
let roadsideLoadFinished = false;
let roadSegmentLength = 20;

function updateLoadingScreen(event, asset = 'vehicle model') {
const progress = event.total ? Math.floor(event.loaded / event.total * 100) : null;
const fill = $('loading-fill');
if (progress !== null) {
fill.style.width = progress + '%';
$('loading-message').textContent = 'Loading ' + asset + '… ' + progress + '%';
$('loading-progress').setAttribute('aria-valuenow', String(progress));
} else {
$('loading-message').textContent = 'Loading ' + asset + '…';
}
}

function finishLoadingScreen() {
  // Wait for both the player car and traffic fleet before allowing gameplay.
  // This prevents fallback traffic from being replaced by loaded GLB models
  // after the race has already started.
  if (startupLoadFinished || !starterLoadFinished || !roadsideLoadFinished) return;
  startupLoadFinished = true;
  $('loading-fill').style.width = '100%';
  $('loading-progress').setAttribute('aria-valuenow', '100');
  $('loading-message').textContent = 'Ready! Traffic continues loading in the background.';
  $('loading-screen').classList.add('hidden');
  $('main-menu').classList.remove('hidden');
}

function loadStarterModel() {
  if (!starterModelPromise) {
    starterModelPromise = new Promise((resolve, reject) => {
// GitHub Pages serves the Git LFS pointer; this URL serves the actual LFS object.
gltfLoader.load('https://media.githubusercontent.com/media/IM2SKIBIDI4U/Traffic-Racer-2.o/main/2023_lexus_ls_500h.glb', (gltf) => resolve(gltf.scene), updateLoadingScreen, reject);
});
}
return starterModelPromise;
}
function prepareStarterModel(source) {
const model = source.clone(true);
model.updateWorldMatrix(true, true);
let front, rear;
model.traverse((object) => {
const name = (object.name || '').toLowerCase();
if (!front && name === 'ext_headlamps') front = object;
if (!rear && name === 'ext_taillamps') rear = object;
});
if (front && rear) {
const frontBox = new THREE.Box3().setFromObject(front);
const rearBox = new THREE.Box3().setFromObject(rear);
const frontCenter = frontBox.getCenter(new THREE.Vector3());
const rearCenter = rearBox.getCenter(new THREE.Vector3());
const frontDirection = frontCenter.sub(rearCenter);
if (frontDirection.lengthSq() > 0.001) {
const currentAngle = Math.atan2(frontDirection.x, frontDirection.z);
model.rotation.y -= currentAngle;
}
}
model.updateWorldMatrix(true, true);
const box = new THREE.Box3().setFromObject(model);
const size = box.getSize(new THREE.Vector3());
const length = Math.max(size.x, size.z);
if (length > 0) if (!Number.isFinite(length) || length <= 0.01) throw new Error('Lexus model has invalid dimensions');
model.scale.multiplyScalar(4.25 / length);
model.updateWorldMatrix(true, true);
const finalBox = new THREE.Box3().setFromObject(model);
const center = finalBox.getCenter(new THREE.Vector3());
model.position.set(-center.x, -finalBox.min.y, -center.z);
model.traverse((object) => {
if (object.isMesh) {
object.castShadow = true;
object.receiveShadow = true;
}
});
return model;
}
function getTrafficWheels(model) {
const wheels = [];
model.traverse((object) => {
const name = (object.name || '').toLowerCase();
if (object.children.length && (name.includes('teker') || name.startsWith('wheels_new_trucks_'))) wheels.push(object);
});
return wheels;
}

// Traffic models keep their original GLB materials, textures and vertex colours,
// just like the Lexus player model. Do not recolour these source assets.
function prepareTrafficModel(source) {
  const model = source.clone(true);
  model.updateWorldMatrix(true, true);
  let front;
  let rear;
  model.traverse((object) => {
    const name = (object.name || '').toLowerCase();
    if (!front && (name.startsWith('on_teker') || name === 'wheels_new_trucks_on')) front = object;
    if (!rear && (name.startsWith('arka_teker') || name === 'wheels_new_trucks_arka1')) rear = object;
  });
  if (front && rear) {
    const frontCenter = new THREE.Box3().setFromObject(front).getCenter(new THREE.Vector3());
    const rearCenter = new THREE.Box3().setFromObject(rear).getCenter(new THREE.Vector3());
    const direction = frontCenter.sub(rearCenter);
    if (direction.lengthSq() > 0.001) model.rotation.y += Math.PI - Math.atan2(direction.x, direction.z);
  }
  model.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.z);
  if (!Number.isFinite(length) || length <= 0) throw new Error('Traffic vehicle model has no measurable dimensions');
  model.scale.multiplyScalar(4.5 / length);
  model.updateWorldMatrix(true, true);
  const scaledBounds = new THREE.Box3().setFromObject(model);
  const center = scaledBounds.getCenter(new THREE.Vector3());
  const scaledSize = scaledBounds.getSize(new THREE.Vector3());
  model.position.set(-center.x, -scaledBounds.min.y, -center.z);
  model.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  model.userData.collisionHalfWidth = Math.max(0.8, scaledSize.x * 0.46);
  model.userData.collisionHalfLength = scaledSize.z * 0.47;
  return model;
}
function loadTrafficModels() {
  gltfLoader.load(
    'https://media.githubusercontent.com/media/im2skibidi4u/Traffic-Racer-2.o/main/traffic_rider_npc_vehicles.glb',
    async (gltf) => {
      try {
        gltf.scene.updateMatrixWorld(true);

        // Extract textures from KHR_materials_pbrSpecularGlossiness if GLTFLoader dropped them
        const parser = gltf.parser;
        const jsonMaterials = parser?.json?.materials || [];
        // Keep recovered material data indexed by the GLTF material index.
        // Material names are not guaranteed to exist or be unique in a GLB.
        const recoveredTextures = [];
        const recoveredDiffuseFactors = [];

        await Promise.all(
          jsonMaterials.map(async (matDef, matIndex) => {
            const specGloss = matDef.extensions?.KHR_materials_pbrSpecularGlossiness;
            const diffuseFactor =
              specGloss?.diffuseFactor ??
              matDef.pbrMetallicRoughness?.baseColorFactor;
            if (Array.isArray(diffuseFactor) && diffuseFactor.length >= 3) {
              recoveredDiffuseFactors[matIndex] = diffuseFactor;
            }

            const texIndex =
              specGloss?.diffuseTexture?.index ??
              matDef.pbrMetallicRoughness?.baseColorTexture?.index;

            if (typeof texIndex === 'number') {
              try {
                const tex = await parser.getDependency('texture', texIndex);
                if (tex) {
                  tex.colorSpace = THREE.SRGBColorSpace;
                  recoveredTextures[matIndex] = tex;
                }
              } catch (e) { /* skip unloadable texture */ }
            }
          })
        );

        let container = gltf.scene;
        while (container.children.length === 1) {
          container = container.children[0];
        }

        container.children.forEach((object, index) => {
          const lowerName = (object.name || '').toLowerCase();
          if (/plane|ground|floor|road|light|camera|backdrop|grid/.test(lowerName)) return;

          let hasMesh = false;

          object.traverse((child) => {
            if (child.isMesh && child.geometry) {
              const posAttr = child.geometry.attributes.position;
              if (!posAttr || posAttr.count === 0) return;
              hasMesh = true;
              child.frustumCulled = false;
              child.visible = true;
              child.castShadow = false;
              child.receiveShadow = false;

              // Keep the GLTFLoader material and vertex-colour attribute intact.
              // Rebuilding materials here discarded authored paint and GLB details.
              const originalMaterials = Array.isArray(child.material)
                ? child.material
                : [child.material];
              for (const originalMaterial of originalMaterials) {
                if (!originalMaterial) continue;

                // GLTFLoader associations give the original material index,
                // which is reliable even when material names are blank/duplicated.
                const materialIndex = parser?.associations?.get(originalMaterial)?.materials;
                const recoveredTexture = Number.isInteger(materialIndex)
                  ? recoveredTextures[materialIndex]
                  : null;
                if (recoveredTexture && !originalMaterial.map) {
                  originalMaterial.map = recoveredTexture;
                }

                const diffuseFactor = Number.isInteger(materialIndex)
                  ? recoveredDiffuseFactors[materialIndex]
                  : null;
                if (diffuseFactor && originalMaterial.color) {
                  originalMaterial.color.setRGB(
                    diffuseFactor[0],
                    diffuseFactor[1],
                    diffuseFactor[2]
                  );
                }

                if (originalMaterial.map) {
                  originalMaterial.map.colorSpace = THREE.SRGBColorSpace;
                }
                if (originalMaterial.emissiveMap) {
                  originalMaterial.emissiveMap.colorSpace = THREE.SRGBColorSpace;
                }
                if (child.geometry.attributes.color && 'vertexColors' in originalMaterial) {
                  originalMaterial.vertexColors = true;
                }
                originalMaterial.needsUpdate = true;
              }
            }
          });

          if (!hasMesh) return;

          const raw = object.clone(true);
          raw.position.set(0, 0, 0);
          raw.updateMatrixWorld(true);

          const rawBox = new THREE.Box3();
          raw.traverse((child) => {
            if (child.isMesh && child.geometry) {
              child.geometry.computeBoundingBox();
              const b = child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld);
              rawBox.union(b);
            }
          });

          const rawSize = rawBox.getSize(new THREE.Vector3());
          if (rawBox.isEmpty() || rawSize.lengthSq() === 0) return;

          const maxHorizontal = Math.max(rawSize.x, rawSize.z);
          const scale = 4.5 / maxHorizontal;
          raw.scale.multiplyScalar(scale);
          raw.updateMatrixWorld(true);

          const scaledBox = new THREE.Box3();
          raw.traverse((child) => {
            if (child.isMesh && child.geometry) {
              const b = child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld);
              scaledBox.union(b);
            }
          });

          const center = scaledBox.getCenter(new THREE.Vector3());
          const size = scaledBox.getSize(new THREE.Vector3());
          raw.position.set(-center.x, -scaledBox.min.y, -center.z);

          const pivot = new THREE.Group();
          pivot.add(raw);
          if (size.x > size.z * 1.15) {
            pivot.rotation.y = Math.PI / 2;
          }
          pivot.rotation.y += Math.PI; // <-- Add this line to turn the cars around 180°
          pivot.updateMatrixWorld(true);

          const finalBox = new THREE.Box3().setFromObject(pivot);
          const finalSize = finalBox.getSize(new THREE.Vector3());

          if (finalSize.y < 0.9 || finalSize.x < 1.2 || finalSize.z < 2.2) return;

          const wrapper = new THREE.Group();
          wrapper.name = object.name || `vehicle_${index}`;
          wrapper.add(pivot);
          wrapper.userData.wheels = getTrafficWheels(wrapper);
          wrapper.userData.collisionHalfWidth = Math.min(1.05, Math.max(0.75, finalSize.x * 0.42));
          wrapper.userData.collisionHalfLength = Math.min(2.4, Math.max(1.6, finalSize.z * 0.44));

          trafficVehicles.push(wrapper);
        });

        if (!trafficVehicles.length) throw new Error('No traffic vehicle models were found');
        // Use only the imported GLB fleet when it loads successfully.
        // Procedural legacy cars are added only by the error fallback below.
      } catch (error) {
        trafficVehicles.length = 0;
        console.error('Could not prepare traffic_rider_npc_vehicles.glb:', error);
        $('loading-message').textContent = 'Traffic models unavailable; using fallback vehicles.';
      } finally {
        trafficLoadFinished = true;
        finishLoadingScreen();
      }
    },
    (event) => updateLoadingScreen(event, 'traffic models'),
    (error) => {
      console.error('Could not load traffic_rider_npc_vehicles.glb:', error);
      createTrafficVariants();
      $('loading-message').textContent = 'Traffic models unavailable; using fallback vehicles.';
      trafficLoadFinished = true;
      finishLoadingScreen();
    }
  );
}
function applyPlayerPaint(color) {
  if (!player || !Number.isFinite(color) || color <= 0) return;
  if (player.userData.paint) player.userData.paint.color.setHex(color);
  const model = player.userData.starterModel;
  if (!model) return;
  if (!player.userData.paintTargets) {
    const targets = [];
    model.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const nextMaterials = materials.slice();
      materials.forEach((source, index) => {
        if (!source?.color) return;
        const label = ((object.name || '') + ' ' + (source.name || '')).toLowerCase();
        if (/glass|window|windshield|wheel|tire|tyre|rubber|light|lamp|interior|seat|chrome|metal|trim|mirror/.test(label)) return;
        const copy = source.clone();
        copy.color.setHex(color);
        nextMaterials[index] = copy;
        targets.push(copy);
      });
      object.material = Array.isArray(object.material) ? nextMaterials : nextMaterials[0];
    });
    player.userData.paintTargets = targets;
  } else {
    for (const target of player.userData.paintTargets) target.color.setHex(color);
  }
}
function applyPlayerCar(carId) {
if (!player) return;
const spec = cars.find((car) => car.id === carId) || cars[0];
if (player.userData.modelStyle !== spec.modelStyle) {
for (const child of player.userData.syntheticChildren || []) {
player.remove(child);
child.traverse((object) => {
object.geometry?.dispose();
for (const item of Array.isArray(object.material) ? object.material : [object.material]) item?.dispose();
});
}
const replacement = createCar(spec.color, true, spec.modelStyle);
const children = [...replacement.children];
for (const child of children) {
replacement.remove(child);
player.add(child);
}
player.userData.syntheticChildren = children;
player.userData.paint = replacement.userData.paint;
player.userData.wheels = replacement.userData.wheels;
player.userData.body = replacement.userData.body;
player.userData.bodyBaseY = replacement.userData.bodyBaseY;
player.userData.modelStyle = replacement.userData.modelStyle;
player.userData.collisionHalfWidth = replacement.userData.collisionHalfWidth;
player.userData.collisionHalfLength = replacement.userData.collisionHalfLength;
}
if (player.userData.starterModel) {
player.remove(player.userData.starterModel);
player.userData.starterModel = null;
player.userData.paintTargets = null;
}
for (const child of player.userData.syntheticChildren || []) child.visible = true;
if (carId === 'starter') {
loadStarterModel()
.then((source) => {
if (selectedCar === carId) {
const model = prepareStarterModel(source);
player.userData.starterModel = model;
player.add(model);
applyPlayerPaint(Number(load('tr-custom-paint',String(spec.color))));
for (const child of player.userData.syntheticChildren || []) child.visible = false;
}
starterLoadFinished = true;
finishLoadingScreen();
})
.catch((err) => {
console.error('Could not load 2023_lexus_ls_500h.glb:', err);
starterLoadFinished = true;
finishLoadingScreen();
});
}
}

const roadsideMetal = material(0x68777d, 0.72, 0.48);
const roadsideWhite = material(0xd8dedb, 0.82);
const roadsideYellow = material(0xe9bd45, 0.72);
const roadsideGlass = material(0x355563, 0.34, 0.22);
function addRoadsideDetails() {
  for (let z = -225; z <= 35; z += 52) {
    for (const side of [-1, 1]) {
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.11, 6.2, 7), roadsideMetal);
      pole.position.y = 3.1;
      lamp.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.09, 0.09), roadsideMetal);
      arm.position.set(-side * 0.52, 5.95, 0);
      lamp.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.16, 0.32), roadsideWhite);
      head.position.set(-side * 1.08, 5.88, 0);
      lamp.add(head);
      lamp.userData.roadLateral = side * 12.7;
      placeOnRoad(lamp, side * 12.7, z);
      lamp.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      scene.add(lamp);
      scenery.push(lamp);

      if (Math.abs(z) % 104 < 1) {
        const sign = new THREE.Group();
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 2.5, 6), roadsideMetal);
        post.position.y = 1.25;
        sign.add(post);
        const board = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.86, 0.1), roadsideGlass);
        board.position.y = 2.65;
        sign.add(board);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.07, 0.025), roadsideYellow);
        stripe.position.set(0, 2.65, 0.065);
        sign.add(stripe);
        sign.userData.roadLateral = side * 13.6;
        placeOnRoad(sign, side * 13.6, z - 13);
        sign.traverse((o) => { if (o.isMesh) o.castShadow = false; });
        scene.add(sign);
        scenery.push(sign);
      }
    }
  }


}

function addRoadsideLandmarks() {
  const frameMat = material(0x303b43, 0.72, 0.25);
  const billboardMats = [0x287d9a, 0xb85b3c, 0x637d45, 0x554b86].map((color) => material(color, 0.78));
  const concrete = material(0x8b9292, 0.95);
  const glass = material(0x6f9eaa, 0.3, 0.12, { transparent: true, opacity: 0.55 });
  for (let index = 0, z = -205; z <= 15; z += 55, index++) {
    const side = index % 2 === 0 ? -1 : 1;
    const billboard = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.2, 0.22), frameMat);
    post.position.y = 2.1;
    billboard.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.15, 0.18), billboardMats[index % billboardMats.length]);
    board.position.set(0.55, 4.25, 0);
    billboard.add(board);
    billboard.userData.roadLateral = side * 19;
    placeOnRoad(billboard, side * 19, z);
    billboard.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    scene.add(billboard);
    scenery.push(billboard);

    if (index % 2 === 1) {
      const shelter = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 2.2), concrete);
      base.position.y = 0.09;
      shelter.add(base);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.18, 2.5), frameMat);
      roof.position.y = 2.55;
      shelter.add(roof);
      for (const x of [-1.9, 1.9]) {
        const support = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.35, 0.12), frameMat);
        support.position.set(x, 1.25, -0.9);
        shelter.add(support);
      }
      const back = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.9, 0.08), glass);
      back.position.set(0, 1.35, -0.95);
      shelter.add(back);
      shelter.userData.roadLateral = -side * 18;
      placeOnRoad(shelter, -side * 18, z - 24);
      shelter.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      scene.add(shelter);
      scenery.push(shelter);
    }
  }
}

function createEnvironment() {
roadSegmentLength = 20;
for (let i = 0; i < 14; i++) createRoad(-i * roadSegmentLength);
for (let i = 0; i < 3; i++) {
const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 600), grassMat);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.2, -250 - i * 600);
ground.receiveShadow = true;
scene.add(ground);
grounds.push(ground);
}
// Build a continuous urban corridor instead of sparse roadside trees.
const cityMaterials = {
  concrete: material(0x626b73, 0.92),
  brick: material(0x86594a, 0.9),
  cream: material(0xb9ad91, 0.88),
  dark: material(0x303b45, 0.82),
  glass: material(0x294b60, 0.24, 0.32),
  litGlass: new THREE.MeshStandardMaterial({ color: 0xffd98a, emissive: 0xffa62b, emissiveIntensity: 0.65, roughness: 0.3 }),
  awning: material(0xa84738, 0.78),
  sidewalk: material(0x8d9290, 0.96),
  curb: material(0xc8c9c4, 0.9)
};
const addCityBuilding = (side, z, index, depthRow = 0) => {
  const group = new THREE.Group();
  const width = 5.5 + Math.random() * 4.5;
  const depth = 7 + Math.random() * 5;
  const floors = 2 + Math.floor(Math.random() * 5);
  const floorHeight = 2.7;
  const height = floors * floorHeight + 1.2;
  const facades = [cityMaterials.concrete, cityMaterials.brick, cityMaterials.cream, cityMaterials.dark];
  const shell = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), facades[index % facades.length]);
  shell.position.y = height / 2;
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  // Recessed-looking windows on the wall facing the street.
  const faceX = -side * (width / 2 + 0.045);
  const windowColumns = Math.max(2, Math.floor(depth / 1.8));
  for (let floor = 0; floor < floors; floor++) {
    for (let column = 0; column < windowColumns; column++) {
      const windowMat = night && Math.random() < 0.42 ? cityMaterials.litGlass : cityMaterials.glass;
      const windowMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 1.05, 0.82),
        windowMat
      );
      windowMesh.position.set(faceX, 1.25 + floor * floorHeight, -depth / 2 + 1.1 + column * ((depth - 1.5) / Math.max(1, windowColumns - 1)));
      group.add(windowMesh);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.94), cityMaterials.dark);
      sill.position.set(faceX - side * 0.045, windowMesh.position.y - 0.56, windowMesh.position.z);
      group.add(sill);
    }
  }

  // Ground-floor shopfront, sign and striped awning make blocks look different.
  const shopGlass = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.8, depth * 0.72), cityMaterials.glass);
  shopGlass.position.set(faceX, 1.15, 0);
  group.add(shopGlass);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, depth * 0.78), cityMaterials.awning);
  sign.position.set(faceX - side * 0.07, 2.35, 0);
  group.add(sign);
  const awning = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.16, depth * 0.78), cityMaterials.awning);
  awning.position.set(-side * (width / 2 + 0.55), 2.0, 0);
  group.add(awning);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(width * 0.86, 0.28, depth * 0.86), cityMaterials.dark);
  roof.position.y = height + 0.14;
  group.add(roof);
  const rooftopUnit = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.2), cityMaterials.concrete);
  rooftopUnit.position.set(0, height + 0.65, 0);
  group.add(rooftopUnit);

  const lateral = side * (depthRow === 1
    ? 44 + Math.random() * 22
    : 22 + Math.random() * 10);
  group.userData.roadLateral = lateral;
  placeOnRoad(group, lateral, z + (Math.random() - 0.5) * 5);
  scene.add(group);
  scenery.push(group);
};

for (let z = -220, index = 0; z < 40; z += 22, index++) {
  for (const side of [-1, 1]) {
    addCityBuilding(side, z, index + (side > 0 ? 1 : 0));
    // Sidewalk slabs and curb stones add a visible street edge.
    const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 20), cityMaterials.sidewalk);
    sidewalk.position.y = -0.03;
    sidewalk.userData.roadLateral = side * 13.7;
    placeOnRoad(sidewalk, side * 13.7, z);
    scene.add(sidewalk);
    scenery.push(sidewalk);
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 20), cityMaterials.curb);
    curb.position.y = 0.05;
    curb.userData.roadLateral = side * 11.75;
    placeOnRoad(curb, side * 11.75, z);
    scene.add(curb);
    scenery.push(curb);
  }

  // Overhead traffic signals and pedestrian-crossing signs every few blocks.
  if (index % 3 === 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const signal = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 8), cityMaterials.dark);
    pole.position.y = 2.7;
    signal.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 0.12), cityMaterials.dark);
    arm.position.set(-side * 1.45, 5.25, 0);
    signal.add(arm);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.05, 0.42), cityMaterials.dark);
    housing.position.set(-side * 2.75, 4.65, 0);
    signal.add(housing);
    for (let lampIndex = 0; lampIndex < 3; lampIndex++) {
      const lens = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 10, 8),
        new THREE.MeshBasicMaterial({ color: [0xff3434, 0xffc247, 0x43d77a][lampIndex], toneMapped: false })
      );
      lens.position.set(-side * 2.75, 4.95 - lampIndex * 0.3, 0.23);
      signal.add(lens);
    }
    signal.userData.roadLateral = side * 13.2;
    placeOnRoad(signal, side * 13.2, z);
    scene.add(signal);
    scenery.push(signal);
  }
}
// Extend the environment beyond the highway into several city blocks.
for (let z = -220, blockIndex = 0; z < 40; z += 22, blockIndex++) {
  for (const side of [-1, 1]) {
    // A second, staggered row of buildings creates a deeper city skyline.
    addCityBuilding(side, z + 10, blockIndex + 3, 1);
  }
}

// Parallel neighborhood streets run through the city on both sides.
const sideStreetMat = material(0x303943, 0.94);
const streetLineMat = material(0xd9d9d1, 0.82);
for (const side of [-1, 1]) {
  const street = new THREE.Group();
  const asphaltStrip = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.18, 270), sideStreetMat);
  asphaltStrip.position.y = -0.015;
  street.add(asphaltStrip);
  for (let dz = -132; dz <= 132; dz += 12) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 5.5), streetLineMat);
    dash.position.set(0, 0.105, dz);
    street.add(dash);
  }
  street.userData.roadLateral = side * 39;
  placeOnRoad(street, side * 39, -85);
  scene.add(street);
  scenery.push(street);
}

// Cross streets connect the main avenue to the neighborhood roads.
for (let z = -209, crossIndex = 0; z < 30; z += 66, crossIndex++) {
  const crossStreet = new THREE.Group();
  const asphaltCrossing = new THREE.Mesh(new THREE.BoxGeometry(150, 0.18, 9), sideStreetMat);
  asphaltCrossing.position.y = -0.015;
  crossStreet.add(asphaltCrossing);
  const centerLine = new THREE.Mesh(new THREE.BoxGeometry(150, 0.035, 0.12), streetLineMat);
  centerLine.position.y = 0.105;
  crossStreet.add(centerLine);
  // Painted pedestrian crossings at both ends of each intersection.
  for (const x of [-7, -5.5, -4, 4, 5.5, 7]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.04, 3.2), streetLineMat);
    stripe.position.set(x, 0.11, 0);
    crossStreet.add(stripe);
  }
  crossStreet.userData.roadLateral = 0;
  placeOnRoad(crossStreet, 0, z);
  scene.add(crossStreet);
  scenery.push(crossStreet);
}

// Highway exits connect the main road to the parallel neighborhood streets.
for (const side of [-1, 1]) {
  for (const z of [-198, -88, 22]) {
    const exitRamp = new THREE.Group();
    const rampSurface = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.18, 42), sideStreetMat);
    rampSurface.position.y = -0.015;
    exitRamp.add(rampSurface);
    for (const edgeX of [-4.1, 4.1]) {
      const edgeLine = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 42), streetLineMat);
      edgeLine.position.set(edgeX, 0.105, 0);
      exitRamp.add(edgeLine);
    }
    exitRamp.userData.roadLateral = side * 24;
    exitRamp.userData.roadRotationOffset = side * 0.58;
    placeOnRoad(exitRamp, side * 24, z, side * 0.58);
    scene.add(exitRamp);
    scenery.push(exitRamp);
    const exitSign = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.3, 0.16), cityMaterials.dark);
    post.position.y = 1.15;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.85, 0.16), material(0x176b45, 0.72));
    board.position.set(0, 2.35, 0);
    exitSign.add(post, board);
    exitSign.userData.roadLateral = side * 13.4;
    placeOnRoad(exitSign, side * 13.4, z - 8);
    scene.add(exitSign);
    scenery.push(exitSign);
  }
}

// Small green spaces and tree groups break up the building rows.
const parkGroundMat = material(0x536f50, 1);
const treeTrunkMat = material(0x594333, 1);
const treeLeafMats = [material(0x315b3c, 1), material(0x477447, 1), material(0x597d4d, 1)];
for (let z = -198, parkIndex = 0; z < 30; z += 88, parkIndex++) {
  for (const side of [-1, 1]) {
    const park = new THREE.Group();
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(13, 0.12, 18), parkGroundMat);
    lawn.position.y = -0.08;
    park.add(lawn);
    for (let treeIndex = 0; treeIndex < 3; treeIndex++) {
      const x = (treeIndex - 1) * 4.2;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 2.1, 7), treeTrunkMat);
      trunk.position.set(x, 1.0, (treeIndex % 2) * 3 - 1.5);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.25 + Math.random() * 0.35, 8, 7), treeLeafMats[(treeIndex + parkIndex) % treeLeafMats.length]);
      crown.position.set(x, 2.65, (treeIndex % 2) * 3 - 1.5);
      park.add(trunk, crown);
    }
    const parkLateral = side * (57 + (parkIndex % 2) * 5);
    park.userData.roadLateral = parkLateral;
    placeOnRoad(park, parkLateral, z);
    scene.add(park);
    scenery.push(park);
  }
}

for (const side of [-1, 1]) {
for (let z = -220; z < 30; z += 18) {
const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 18), material(0x778389, 0.6, 0.4));
rail.userData.roadLateral = side * 11.6;
rail.position.y = 0.65;
placeOnRoad(rail, side * 11.6, z);
scene.add(rail);
scenery.push(rail);
const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 8), material(0x9ba6a2, 0.6, 0.3));
post.userData.roadLateral = side * 11.55;
post.position.y = 0.45;
placeOnRoad(post, side * 11.55, z);
scene.add(post);
scenery.push(post);
}
}

  addRoadsideDetails();
  addRoadsideLandmarks();
  createOpenCityWorld();
}

function loadRoadsideModels() {
  // All roadside props are procedural; no large gas-station asset is downloaded.
  roadsideLoadFinished = true;
  finishLoadingScreen();
}

function getTrafficPaceKmh() {
  // Civilian traffic should move with the current chase instead of using
  // unrelated random speeds. Nearby police pace influences the flow slightly.
  const policeAverage = policeChasers.length
    ? policeChasers.reduce((sum, unit) => sum + (unit.speed || 0), 0) / policeChasers.length
    : actualSpeed;
  // Civilian traffic should cruise well below the player's speed.
  return 78;
}

function chooseTrafficLane() {
if (roadMode === 'one-way') return lanes[Math.floor(Math.random() * lanes.length)];
return Math.random() < 0.38 ? lanes[Math.floor(Math.random() * 2)] : lanes[2 + Math.floor(Math.random() * 2)];
}
function attachTrafficTurnSignals(vehicle) {
  const signals={left:[],right:[]};
  for(const side of [-1,1]) for(const z of [2.05,-2.05]) {
    const lamp=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.1,0.06),new THREE.MeshBasicMaterial({color:0xffa52f,toneMapped:false}));
    lamp.position.set(side*0.82,0.82,z);lamp.visible=false;vehicle.add(lamp);
    signals[side<0?'left':'right'].push(lamp);
  }
  vehicle.userData.turnSignals=signals;
}
function spawnTraffic() {
  const trafficLimit = Math.min(20, 14 + Math.floor(score / 900));
  if (traffic.length >= trafficLimit) return false;

  // Spawn into a spread of distance bands so cars are already visible well
  // before the player reaches them, without appearing in a single distant wall.
  // Spawn beyond the fog horizon so traffic emerges gradually instead of popping into nearby lanes.
  const spawnBands = [-220, -255, -290];
  const laneOptions = [...lanes];
  const candidates = [];
  for (const candidate of laneOptions) {
    const oncomingLane = false;
    const sameDirection = traffic.filter((item) =>
      item.oncoming === oncomingLane && Math.abs(item.lane - candidate) < 0.2
    );
    for (const band of spawnBands) {
      const z = band - Math.random() * 18;
      const clear = !sameDirection.some((item) => Math.abs(item.pathZ - z) < 34);
      if (clear) candidates.push({ lane: candidate, z, oncoming: oncomingLane,
        load: sameDirection.length + Math.random() * 0.35 });
    }
  }
  if (!candidates.length) return false;
  candidates.sort((a, b) => a.load - b.load);
  const pool = candidates.filter((candidate) => candidate.load <= candidates[0].load + 0.6);
  const spawn = pool[Math.floor(Math.random() * pool.length)];
  const { lane, z, oncoming } = spawn;
  const difficulty = Math.min(8, Math.floor(score / 500));
  const paceOffset = (Math.random() - 0.5) * 24;
  const botSpeed = THREE.MathUtils.clamp(getTrafficPaceKmh() + paceOffset * 0.35, 68, 92);
  const colors = [0xe8e5dc, 0xb84238, 0x334f66, 0x8b9b92, 0xc59b4e, 0x252a32];
  const isPolice = gameMode === 'escape' && score > 250 && Math.random() < 0.025;
  // In Police mode, keep exactly one marked suspect active at a time.
  const isTarget = gameMode === 'police' && !traffic.some((item) => item.isTarget);
  let car;
  const fleet = activeTrafficVehicles || [];
  if (isPolice) {
    car = createCar(0x172b46, false, 0);
    car.name = 'police_patrol';
    const lightBar = new THREE.Mesh(new THREE.BoxGeometry(0.82,0.12,0.24),material(0x18202a,0.35));
    lightBar.position.set(0,1.72,-0.12);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.32,0.13,0.22),new THREE.MeshBasicMaterial({color:0xff253c}));
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.32,0.13,0.22),new THREE.MeshBasicMaterial({color:0x258bff}));
    red.position.set(-0.23,1.73,-0.12); blue.position.set(0.23,1.73,-0.12);
    car.add(lightBar,red,blue); car.userData.policeLights=[red,blue];
  } else if (fleet.length) {
    const source = fleet[Math.floor(Math.random() * fleet.length)];
    car = source.clone(true);
    car.userData.wheels = getTrafficWheels(car);
    car.userData.collisionHalfWidth = source.userData.collisionHalfWidth;
    car.userData.collisionHalfLength = source.userData.collisionHalfLength;
  } else {
    car = createCar(colors[Math.floor(Math.random() * colors.length)], false, Math.floor(Math.random() * 4));
    // Traffic heading is applied once below through trafficDirectionOffset.
  }
  if (isTarget) {
    car.name = 'police_mode_target';
    const beacon = new THREE.Group();
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0x35eaff, toneMapped: false })
    );
    glow.position.y = 2.35;
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.72, 0.075, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0x35eaff, transparent: true, opacity: 0.9, toneMapped: false })
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 2.35;
    const beaconLight = new THREE.PointLight(0x35eaff, 2.2, 15, 2);
    beaconLight.position.y = 2.35;
    beacon.add(glow, halo, beaconLight);
    car.add(beacon);
    car.userData.targetBeacon = beacon;
  }
  attachTrafficTurnSignals(car);
  const baseHeading = car.rotation.y;
  const trafficDirectionOffset = (oncoming ? 0 : Math.PI) + Math.PI;
  placeOnRoad(car, lane, z, baseHeading + trafficDirectionOffset);
  if (night) {
    const light = new THREE.PointLight(0xffe4b7, 0.45, 12, 2);
    light.position.set(0, 0.8, oncoming ? -2.8 : 2.8);
    car.add(light);
  }
  scene.add(car);
  if (traffic.length === 0) {
    const b = new THREE.Box3().setFromObject(car);
    console.log('First spawned car:', {
      pos: car.position.toArray(),
      min: b.min.toArray(),
      max: b.max.toArray(),
      meshes: car.getObjectsByProperty('isMesh', true).length
    });
  }
  traffic.push({
    mesh: car, lane, oncoming, botSpeed,
    paceOffset,
    lateralX: lane,
    pathZ: z,
    baseHeading,
    trafficDirectionOffset,
    targetSpeed: botSpeed,
    targetLane: lane,
    laneChangeCooldown: 2 + Math.random() * 5,
    drivingStyle: Math.random(),
    checkedMiss: false,
    isTarget,
    previousZ: z,
    physicsVelX: 0,
    physicsVelZ: 0
  });
  return true;
}
function clearTraffic() {
for (const item of traffic) scene.remove(item.mesh);
traffic.length = 0;
}
function refreshWallet() {
refreshDailyDate();
for (const id of ['wallet', 'menu-wallet', 'garage-wallet']) {
$(id).textContent = credits.toLocaleString();
}
const count=$('achievement-count');
if(count) count.textContent=String(unlockedAchievements.size);
const daily=$('daily-challenge-progress');
if(daily) daily.textContent=dailyClaimed?'DAILY CHALLENGE · COMPLETED (+100 CREDITS)':'DAILY CHALLENGE · DRIVE 2,000 M IN ONE RUN · '+Math.min(2000,dailyProgress).toLocaleString()+'/2,000 M';
}
function renderGarage() {
const list = $('car-list');
list.replaceChildren();
for (const car of cars) {
const isOwned = owned.has(car.id);
const button = document.createElement('button');
button.className = 'car-card' + (selectedCar === car.id ? ' selected' : '');
button.style.setProperty('--car-color', '#' + car.color.toString(16).padStart(6, '0'));
const state = isOwned ? (selectedCar === car.id ? 'SELECTED' : 'OWNED') : '◆ ' + car.cost.toLocaleString();
button.innerHTML =
'<span class="car-swatch"></span>' +
'<span class="car-name">' + car.name + '</span>' +
'<span class="car-cost ' + (isOwned ? 'owned' : '') + '">' + state + '</span>' +
'<span class="car-cost">' + car.maxSpeed + ' top · ' + car.acceleration + ' accel</span>';
button.addEventListener('click', () => {
if (!isOwned && credits < car.cost) {
button.querySelector('.car-cost').textContent = 'NEED ' + (car.cost - credits).toLocaleString() + ' MORE';
return;
}
if (!isOwned) {
credits -= car.cost;
owned.add(car.id);
save('tr-credits', credits);
save('tr-owned', JSON.stringify([...owned]));
}
selectedCar = car.id;
save('tr-car', selectedCar);
applyPlayerCar(selectedCar);
const customPaint=Number(load('tr-custom-paint','0'));
applyPlayerPaint(customPaint>0?customPaint:car.color);
refreshWallet();
renderGarage();
});
list.append(button);
}
const upgradePanel=document.createElement('div');
upgradePanel.className='upgrade-panel';
upgradePanel.innerHTML='<h3>PERFORMANCE UPGRADES</h3><p>Engine Lv. '+upgradeLevels.engine+'/5 · Handling Lv. '+upgradeLevels.handling+'/5 · Brakes Lv. '+upgradeLevels.brakes+'/5</p>';
for(const [key,label] of [['engine','ENGINE'],['handling','HANDLING'],['brakes','BRAKES']]){
  const button=document.createElement('button'); button.className='secondary-button';
  const cost=350*(upgradeLevels[key]+1);
  button.textContent=upgradeLevels[key]>=5?label+' MAXED': 'UPGRADE '+label+' · '+cost+' CREDITS';
  button.disabled=upgradeLevels[key]>=5;
  button.addEventListener('click',()=>{
    if(upgradeLevels[key]>=5)return;
    if(credits<cost){button.textContent='NEED '+(cost-credits)+' MORE CREDITS';return;}
    credits-=cost;upgradeLevels[key]++;save('tr-upgrades',JSON.stringify(upgradeLevels));
    refreshWallet();renderGarage();
  });
  upgradePanel.append(button);
}
list.append(upgradePanel);
const paintPanel=document.createElement('div'); paintPanel.className='paint-panel';
paintPanel.innerHTML='<h3>PAINT SHOP</h3>';
for(const color of [0x1678c8,0xd54b3e,0x32a879,0xe9a33b,0xe8e8e8,0x252a32,0x8c65bd]){
  const swatch=document.createElement('button');swatch.className='paint-swatch';swatch.style.background='#'+color.toString(16).padStart(6,'0');swatch.setAttribute('aria-label','Choose paint');
  swatch.addEventListener('click',()=>{
    applyPlayerPaint(color);
    save('tr-custom-paint',String(color));
    for(const button of paintPanel.querySelectorAll('.paint-swatch')) button.style.outline='none';
    swatch.style.outline='2px solid #ffffff';
  });
  paintPanel.append(swatch);
}
list.append(paintPanel);
if (!list.querySelector('.sketchfab-link')) {
const link = document.createElement('a');
link.className = 'secondary-button sketchfab-link';
link.href = 'https://sketchfab.com/search?features=downloadable&type=models&q=car';
link.target = '_blank';
link.rel = 'noopener noreferrer';
link.textContent = 'Browse downloadable Sketchfab cars ↗';
list.append(link);
}
refreshWallet();
}
function showPage(id) {
document.querySelectorAll('.overlay').forEach((page) => {
  page.classList.add('hidden');
  // Force hidden overlays off even if another rule or stale inline style
  // overrides the .hidden class.
  page.style.setProperty('display', 'none', 'important');
  page.style.removeProperty('opacity');
  page.style.removeProperty('pointer-events');
  page.style.removeProperty('z-index');
});
if (id) {
  const activePage = $(id);
  activePage.classList.remove('hidden');
  activePage.style.setProperty('display', 'grid', 'important');
}
}
function showMenu() {
  refreshDailyDate();
  running = false;
  paused = false;
  actualSpeed = 0;
  nitroActive = false;
  Object.keys(keys).forEach((key) => { keys[key] = false; });
  showPage('main-menu');
}
function showGarage() { if (running) { running = false; paused = false; } renderGarage(); showPage('garage-page'); }
function showSettings() { if (running) { running = false; paused = false; } syncSettings(); showPage('settings-page'); }
function syncModeButtons() {
  $('mode-escape').classList.toggle('active',gameMode==='escape');
  $('mode-police').classList.toggle('active',gameMode==='police');
  $('mode-escape').setAttribute('aria-pressed',String(gameMode==='escape'));
  $('mode-police').setAttribute('aria-pressed',String(gameMode==='police'));
}
function syncSettings() {
const set = (id, label, active) => {
const button = $(id);
button.textContent = label;
button.classList.toggle('active', active);
button.setAttribute('aria-pressed', String(active));
};
set('auto-toggle', autoAccel ? 'ON' : 'OFF', autoAccel);
set('road-mode-toggle', 'ONE WAY', true);
set('night-toggle', night ? 'NIGHT' : 'DAY', night);
set('sound-toggle', soundEnabled ? 'ON' : 'OFF', soundEnabled);
$('road-mode-note').textContent = roadMode === 'one-way'
? 'All four lanes travel in your direction.'
: 'Two lanes each way with a double-yellow divider.';
}
function startGame() {
refreshDailyDate();
for (const key of Object.keys(keys)) keys[key] = false;
if ($('game-over')) $('game-over').style.display = '';
score = 0;
$('game-over-title').textContent=gameMode==='police'?'SHIFT ENDED':'CHASE OVER';
clearPoliceChase();
setPlayerPoliceLights(gameMode === 'police');
dailyProgress=0; save('tr-daily-progress','0'); save('tr-daily-progress-date',dailyDate);
hitCooldown=0;
collisionRecoil=0;
collisionYaw=0;
collisionAngularVelocity=0;
collisionHeading=0;
for (const unit of policeChasers) {
  unit.lateralVelocity = 0;
  unit.longitudinalVelocity = 0;
  unit.observedPlayerSpeed = 0;
}
playerHealth = 100;
repairSpawnTimer = 3;
for (const pickup of repairPickups) scene.remove(pickup.mesh);
repairPickups.length = 0;
const healthValue = $('health-value');
if (healthValue) {
  healthValue.textContent = '100%';
  healthValue.closest('.health-heading')?.style.setProperty('display', '');
}
const healthBar = $('health-bar');
if (healthBar) {
  healthBar.style.width = '100%';
  healthBar.closest('.meter')?.style.setProperty('display', '');
}
actualSpeed = 0;
steerVelocity = 0;
citySpeedMps = 0;
cityHeading = 0;
cityDistance = 0;
cityRepairTimer = 3;
dragRaceActive=false;
cityOnFoot=false;if(cityAvatar){scene.remove(cityAvatar);cityAvatar=null;}if(cityParkedCar){scene.remove(cityParkedCar);cityParkedCar=null;}if(player)player.visible=true;
cityWantedLevel=0; cityLawbreakingTime=0; cityPoliceSpawnTimer=0;
if(cityCrimeHud)cityCrimeHud.style.display='none';
if(dragRaceOpponent)dragRaceOpponent.visible=false;
if(dragRaceHud)dragRaceHud.style.display='none';
for(const kit of cityRepairPickups)scene.remove(kit);
cityRepairPickups.length=0;
takedownCharge = 0;
if (cityWorldReady) {
  player.position.copy(citySpawnPosition);
  player.rotation.set(0,0,0);
  for (const bot of cityTraffic) scene.remove(bot.mesh);
  for (const cop of cityPolice) scene.remove(cop.mesh);
  cityTraffic.length = 0;
  cityPolice.length = 0;
}
nitro = 100;
nitroActive = false;
spawnTimer = 0.75;
burstTimer = 0;
burstCooldown = 8 + Math.random() * 7;
cameraShake = 0;
nearMissChain = 0;
playerLateral = lanes.at(2);
if (cityWorldReady) {
  player.position.copy(citySpawnPosition);
  player.rotation.set(0, 0, 0);
} else {
  placeOnRoad(player, playerLateral, 7);
  player.rotation.set(0, roadHeading(7), 0);
  updateCamera(0, 0);
}
clearTraffic();
// Keep one consistent vehicle fleet for the whole run if the GLB finishes loading mid-race.
activeTrafficVehicles = trafficVehicles.length ? trafficVehicles.slice() : null;
for (const particle of particles) scene.remove(particle.mesh);
particles.length = 0;
$('score').textContent = '0';
$('speed').textContent = '0';
$('nitro-fill').style.width = '100%';
$('speed-lines').style.opacity = '0';
running = true;
paused = false;
// Put a vehicle on the road immediately. The timed spawner continues adding
// traffic afterward, but the player never starts with an empty highway.
if (!cityWorldReady && traffic.length === 0) spawnTraffic();
if (!cityWorldReady && gameMode === 'escape') spawnPoliceChaser(0);
spawnTimer = 0.75;
showPage('');
if (soundEnabled) {
initAudio();
audioContext?.resume();
}
}
function awardCredits(amount) {
const reward = Math.max(0, Math.floor(amount));
if (!reward) return;
credits += reward;
save('tr-credits', credits);
refreshWallet();
}
function showNearMiss() {
nearMissChain = Math.min(nearMissChain + 1, 4);
const reward = 5 + (nearMissChain - 1) * 2;
awardCredits(reward);
const toast = $('near-miss');
unlockAchievement('close-call','CLOSE CALL',25);
toast.innerHTML = 'NEAR MISS! +' + reward + '';
toast.classList.add('show');
window.clearTimeout(showNearMiss.timeout);
showNearMiss.timeout = window.setTimeout(() => toast.classList.remove('show'), 950);
}
function finishGame() {
  if (!running) return;
  const resultTitle=$('game-over-title');
  if(resultTitle && !resultTitle.textContent)resultTitle.textContent=gameMode==='police'?'SHIFT COMPLETE':'CHASE OVER';
  running = false;
  paused = false;
  actualSpeed = 0;
  steerVelocity = 0;
  nitroActive = false;
  // The crash flash communicates the end impact; don't teleport the
  // camera when the update loop has stopped.
  cameraShake = 0;

  try {
    if (audioContext && engineGain) {
      engineGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.05);
    }
  } catch (e) { /* ignore audio errors */ }

  try {
    const flash = $('crash-flash');
    if (flash) {
      flash.classList.remove('active');
      void flash.offsetWidth;
      flash.classList.add('active');
    }

    const distanceMeters = Math.floor(score || 0);
    // Near-miss rewards are credited immediately by awardCredits().
    // Only add the distance bonus here so near misses are not paid twice.
    const earned = Math.max(0, Math.floor(distanceMeters / 25));
    credits = (credits || 0) + earned;
    save('tr-credits', credits);
    if (typeof refreshWallet === 'function') refreshWallet();

    if ($('final-score')) {
      $('final-score').innerHTML = `${distanceMeters.toLocaleString()} <small>METERS</small>`;
    }
    if ($('earned-credits')) {
      $('earned-credits').textContent = `+${earned.toLocaleString()} credits`;
    }
  } catch (e) {
    console.error('Error updating end screen stats:', e);
  }

  // Use the same overlay visibility rules as every other screen. Avoid
  // inline display styles, which can override .overlay.hidden on Main Menu.
  showPage('game-over');
}
function initAudio() {
if (!soundEnabled || audioContext) return;
const AudioClass = window.AudioContext || window.webkitAudioContext;
if (!AudioClass) return;
audioContext = new AudioClass();
engineOscillator = audioContext.createOscillator();
engineOscillator.type = 'sawtooth';
engineFilter = audioContext.createBiquadFilter();
engineFilter.type = 'lowpass';
engineFilter.frequency.value = 190;
engineGain = audioContext.createGain();
engineGain.gain.value = 0;
engineOscillator.connect(engineFilter).connect(engineGain).connect(audioContext.destination);
engineOscillator.start();
}
function playTone(frequency, duration, type = 'sine', volume = 0.06) {
if (!soundEnabled) return;
initAudio();
if (!audioContext) return;
const oscillator = audioContext.createOscillator();
const gain = audioContext.createGain();
oscillator.type = type;
oscillator.frequency.value = frequency;
gain.gain.setValueAtTime(volume, audioContext.currentTime);
gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
oscillator.connect(gain).connect(audioContext.destination);
oscillator.start();
oscillator.stop(audioContext.currentTime + duration);
}
function updateAudio() {
if (!audioContext || !engineOscillator) return;
if (audioContext.state === 'suspended') audioContext.resume();
engineOscillator.frequency.setTargetAtTime(48 + actualSpeed + (nitroActive ? 25 : 0), audioContext.currentTime, 0.1);
engineFilter.frequency.setTargetAtTime(140 + actualSpeed * 1.2, audioContext.currentTime, 0.12);
engineGain.gain.setTargetAtTime(running ? (nitroActive ? 0.04 : 0.02) : 0, audioContext.currentTime, 0.12);
}
function setNight(value) {
night = value;
const theme=locationThemes[locationIndex] || locationThemes[0];
const color = night ? nightColor : new THREE.Color(theme.sky);
scene.background.copy(color);
scene.fog.color.copy(color);
hemi.intensity = night ? 0.45 : 1.45;
sun.intensity = night ? 0.18 : 2.2;
sun.color.set(night ? 0x9ab8ff : 0xffe6c6);
if (player?.userData.headlamp) player.userData.headlamp.intensity = night ? 2.8 : 0;
const fogRanges={clear:[140,340],rain:[105,245],fog:[38,155],snow:[75,205]}[weatherMode] || [140,340];
scene.fog.near=fogRanges[0]; scene.fog.far=fogRanges[1];
save('tr-night', night);
syncSettings();
}
function setWeather(mode) {
  weatherMode = ['clear', 'rain', 'fog', 'snow'].includes(mode) ? mode : 'clear';
  save('tr-weather', weatherMode);
  const cfg = {
    clear: [140, 340, night ? 0.45 : 1.45, night ? 0.18 : 2.2, 0.94],
    rain: [105, 245, night ? 0.35 : 0.9, night ? 0.12 : 1.25, 0.3],
    fog: [38, 155, 0.8, 0.75, 0.94],
    snow: [75, 205, 1.05, 1.0, 0.82]
  }[weatherMode];
  scene.fog.near = cfg[0]; scene.fog.far = cfg[1];
  hemi.intensity = cfg[2]; sun.intensity = cfg[3];
  roadMat.roughness = cfg[4];
  roadMat.metalness = weatherMode === 'rain' ? 0.16 : 0.02;
  if (weatherMode === 'rain' || weatherMode === 'snow') {
    if (!weatherParticles) {
      const positions = new Float32Array(420 * 3);
      for (let i=0;i<420;i++) {
        positions[i*3]=(Math.random()-.5)*42;
        positions[i*3+1]=Math.random()*22;
        positions[i*3+2]=-Math.random()*115;
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
      weatherParticles=new THREE.Points(geometry,new THREE.PointsMaterial({color:0x9cc9e8,size:0.06,transparent:true,opacity:0.55}));
      scene.add(weatherParticles);
    }
    weatherParticles.visible=true;
    weatherParticles.material.color.setHex(weatherMode==='snow'?0xeaf6ff:0x9cc9e8);
    weatherParticles.material.size=weatherMode==='snow'?0.11:0.055;
  } else if (weatherParticles) weatherParticles.visible=false;
  if ($('weather-toggle')) $('weather-toggle').textContent=weatherMode.toUpperCase();
}
function setLocation(index) {
  locationIndex=(index+locationThemes.length)%locationThemes.length;
  const theme=locationThemes[locationIndex];
  if(!night){scene.background.setHex(theme.sky);scene.fog.color.setHex(theme.fog);}
  grassMat.color.setHex(theme.ground);
  save('tr-location',String(locationIndex));
  if($('location-toggle')) $('location-toggle').textContent=theme.name;
}
function effectiveCarStats(spec) {
  const traction = weatherMode === 'snow' ? 0.7 : weatherMode === 'rain' ? 0.86 : weatherMode === 'fog' ? 0.96 : 1;
  return {
    maxSpeed: (spec.maxSpeed + upgradeLevels.engine*8) * (weatherMode === 'snow' ? 0.82 : weatherMode === 'rain' ? 0.92 : 1),
    acceleration: (spec.acceleration + upgradeLevels.engine*1.8) * traction,
    handling: (spec.handling + upgradeLevels.handling*0.65) * traction,
    braking: (45 + upgradeLevels.brakes*8) * (weatherMode === 'snow' ? 0.7 : weatherMode === 'rain' ? 0.84 : 1)
  };
}
function saveAchievements() { save('tr-achievements',JSON.stringify([...unlockedAchievements])); }
function unlockAchievement(id,label,reward=0) {
  if(unlockedAchievements.has(id)) return;
  unlockedAchievements.add(id);
  saveAchievements();
  if(reward>0) awardCredits(reward);
  const toast=$('achievement-toast');
  if(toast) {
    toast.textContent='ACHIEVEMENT: '+label+(reward>0?' · +'+reward+' CREDITS':'');
    toast.classList.add('show');
    window.clearTimeout(unlockAchievement.timeout);
    unlockAchievement.timeout=window.setTimeout(()=>toast.classList.remove('show'),2400);
  }
  refreshWallet();
}
function updateProgression() {
  refreshDailyDate();
  const meters=Math.floor(score);
  if(meters>=1000)unlockAchievement('one-km','1 KM DRIVER',50);
  if(meters>=5000)unlockAchievement('five-km','HIGHWAY REGULAR',150);
  if(meters>=10000)unlockAchievement('ten-km','ROAD LEGEND',300);
  if(meters>=dailyProgress) { dailyProgress=meters; save('tr-daily-progress',String(dailyProgress)); save('tr-daily-progress-date',dailyDate); }
  const dailyLabel=$('daily-challenge-progress');
  if(dailyLabel) dailyLabel.textContent=dailyClaimed?'DAILY CHALLENGE · COMPLETED (+100 CREDITS)':'DAILY CHALLENGE · DRIVE 2,000 M IN ONE RUN · '+Math.min(2000,meters).toLocaleString()+'/2,000 M';
  if(!dailyClaimed && meters>=2000) {
    dailyClaimed=true; save('tr-daily-claimed',dailyDate); awardCredits(100);
    const toast=$('achievement-toast'); toast.textContent='DAILY CHALLENGE COMPLETE: +100 CREDITS';
    toast.classList.add('show'); window.clearTimeout(unlockAchievement.timeout);
    unlockAchievement.timeout=window.setTimeout(()=>toast.classList.remove('show'),2600);
  }
}
function updateWeather(dt) {
  weatherClock += dt; dayCycleClock += dt;
  if (dayCycleClock >= 105) { dayCycleClock=0; setNight(!night); }
  if (weatherClock >= 95) {
    weatherClock=0;
    const modes=['clear','rain','fog','snow'];
    setWeather(modes[(modes.indexOf(weatherMode)+1)%modes.length]);
  }
  if (weatherParticles?.visible) {
    const attr=weatherParticles.geometry.attributes.position;
    const speed=weatherMode==='snow'?5:34;
    for(let i=0;i<attr.count;i++){
      let y=attr.getY(i)-speed*dt, z=attr.getZ(i)+(weatherMode==='snow'?5:8)*dt;
      if(y<0||z>18){y=12+Math.random()*10;z=-90-Math.random()*25;attr.setX(i,(Math.random()-.5)*42);}
      attr.setY(i,y);attr.setZ(i,z);
    }
    attr.needsUpdate=true;
  }
}
function addSparks(position, count = 20) {
const sparkColors = [0xffd27a, 0xff783d, 0xe9f7ff];
for (let i = 0; i < count; i++) {
const mesh = new THREE.Mesh(
new THREE.SphereGeometry(0.045, 5, 5),
new THREE.MeshBasicMaterial({ color: sparkColors[i % 3] })
);
mesh.position.copy(position);
scene.add(mesh);
particles.push({
mesh,
velocity: new THREE.Vector3((Math.random() - 0.5) * 13, Math.random() * 8, (Math.random() - 0.5) * 13),
life: 0.4 + Math.random() * 0.4
});
}
}
function updateWorld(dt) {
const move = actualSpeed / 3.6 * 2 * dt;
for (const road of roads) {
  const station = (road.userData.roadStation ?? road.position.z) + move;
  const loopLength = roads.length * roadSegmentLength;
  const recycleAt = 7 + roadSegmentLength / 2 + 18;
  road.userData.roadStation = station >= recycleAt ? station - loopLength : station;
  placeOnRoad(road, 0, road.userData.roadStation);
}
for (const prop of scenery) {
  let roadZ = (prop.userData.roadZ ?? prop.position.z) + move;
  if (roadZ > 28) roadZ -= 270;
  prop.userData.roadZ = roadZ;
  const lateral = prop.userData.roadLateral ?? prop.position.x;
  prop.userData.roadLateral = lateral;
  const y = prop.position.y;
  placeOnRoad(prop, lateral, roadZ, prop.userData.roadRotationOffset || 0);
  prop.position.y = y;
}
for (const ground of grounds) {
  ground.position.z += move;
  if (ground.position.z > 350) ground.position.z -= grounds.length * 600;
}
asphalt.offset.y = (asphalt.offset.y - move * 0.018) % 1;
}
function attachPlayerTurnSignals() {
  if (!player) return;
  const signals={left:[],right:[]};
  for(const side of [-1,1]) for(const z of [2.05,-2.05]) {
    const lamp=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.1,0.06),new THREE.MeshBasicMaterial({color:0xffa52f,toneMapped:false}));
    lamp.position.set(side*0.82,0.82,z);lamp.visible=false;player.add(lamp);
    signals[side<0?'left':'right'].push(lamp);
  }
  player.userData.turnSignals=signals;
}
function addPoliceLightbar(vehicle) {
  if(vehicle.userData.policeLightParts)return;
  const base=new THREE.Mesh(new THREE.BoxGeometry(0.95,0.12,0.28),material(0x111820,0.32,0.35));
  const red=new THREE.Mesh(new THREE.BoxGeometry(0.38,0.14,0.25),new THREE.MeshBasicMaterial({color:0xff2038,toneMapped:false}));
  const blue=new THREE.Mesh(new THREE.BoxGeometry(0.38,0.14,0.25),new THREE.MeshBasicMaterial({color:0x258bff,toneMapped:false}));
  base.position.set(0,1.83,-0.12);red.position.set(-0.25,1.85,-0.12);blue.position.set(0.25,1.85,-0.12);
  vehicle.add(base,red,blue);vehicle.userData.policeLightParts=[red,blue];
}
function setPlayerPoliceLights(active) {
  if(!player)return;
  if(active)addPoliceLightbar(player);
  if(player.userData.policeLightParts)for(const lamp of player.userData.policeLightParts)lamp.visible=!!active;
}
function clearPoliceChase() {
  for (const unit of policeChasers) scene.remove(unit.mesh);
  policeChasers.length = 0;
  policeCatchTime = 0;
  escapeProgress = 0;
  arrests = 0;
}
function spawnPoliceChaser(offset = 0) {
  const car = createCar(0x172b46, false, 2);
  car.name = 'police_pursuit_unit';
  addPoliceLightbar(car);
  scene.add(car);
  const index = policeChasers.length;
  const roles = ['front', 'rear', 'left', 'right'];
  const role = roles[index % roles.length];
  const lateral = THREE.MathUtils.clamp(playerLateral + offset, -6.8, 6.8);
  const pathZ = 30 + index * 7;
  // Police begin behind the player, then accelerate to pass and lead.
  placeOnRoad(car, lateral, pathZ, 0);
  policeChasers.push({
    mesh: car, pathZ, lateral, speed: 0, offset, role, health: 200, ramCooldown: 0, disabled: false,
    massKg: 1950, impactVelX: 0, impactVelZ: 0, angularVelocity: 0, collisionHeading: 0,
    lateralVelocity: 0, longitudinalVelocity: 0, observedPlayerSpeed: 0,
    observedBrake: 0, maneuver: 'approach'
  });
}

// Shared 2D impulse solver for vehicle contacts. Velocities are metres/second
// in lateral/forward axes; restitution is deliberately low for heavy road cars.
// Shared 2D rigid-body contact solver. It transfers linear and angular
// momentum at the contact point, with bounded restitution and stable inertia.
function resolveVehicleImpulse(a, b, normalX, normalZ, massA, massB, restitution = 0.1) {
  const length = Math.hypot(normalX, normalZ) || 1;
  const nx = normalX / length, nz = normalZ / length;
  const invA = 1 / Math.max(650, massA), invB = 1 / Math.max(650, massB);
  const inertia = (body, mass) => {
    const w = Math.max(0.75, body.halfWidth || 1.05) * 2;
    const l = Math.max(1.5, body.halfLength || 2.2) * 2;
    return Math.max(700, mass * (w*w + l*l) / 12);
  };
  const iA = inertia(a, massA), iB = inertia(b, massB);
  const rAx = nx * (a.halfWidth || 1.05), rAz = nz * (a.halfLength || 2.2);
  const rBx = -nx * (b.halfWidth || 1.05), rBz = -nz * (b.halfLength || 2.2);
  const crossA = rAz * nx - rAx * nz;
  const crossB = rBz * nx - rBx * nz;
  const omegaA = a.omega || 0, omegaB = b.omega || 0;
  const pointAVx = (a.vx || 0) + omegaA * rAz;
  const pointAVz = (a.vz || 0) - omegaA * rAx;
  const pointBVx = (b.vx || 0) + omegaB * rBz;
  const pointBVz = (b.vz || 0) - omegaB * rBx;
  const closingSpeed = (pointAVx - pointBVx) * nx + (pointAVz - pointBVz) * nz;
  if (closingSpeed >= 0) return { impulse: 0, aX: 0, aZ: 0, bX: 0, bZ: 0, aAngular: 0, bAngular: 0 };
  const denominator = invA + invB + crossA*crossA/iA + crossB*crossB/iB;
  const impulse = Math.min(85000, -(1 + THREE.MathUtils.clamp(restitution, 0, 0.22)) * closingSpeed / denominator);
  const aX = impulse * invA * nx, aZ = impulse * invA * nz;
  const bX = -impulse * invB * nx, bZ = -impulse * invB * nz;
  const aAngular = impulse * crossA / iA, bAngular = -impulse * crossB / iB;
  a.vx = (a.vx || 0) + aX; a.vz = (a.vz || 0) + aZ;
  b.vx = (b.vx || 0) + bX; b.vz = (b.vz || 0) + bZ;
  a.omega = THREE.MathUtils.clamp(omegaA + aAngular, -1.35, 1.35);
  b.omega = THREE.MathUtils.clamp(omegaB + bAngular, -1.35, 1.35);
  return { impulse, aX, aZ, bX, bZ, aAngular, bAngular };
}

function separatePoliceHitbox(policeUnit, otherZ, otherLane, otherWidth, otherLength, keepPolicePlanted = false) {
  const policeWidth = policeUnit.mesh.userData.collisionHalfWidth || 1.08;
  const policeLength = policeUnit.mesh.userData.collisionHalfLength || 2.4;
  const dx = policeUnit.lateral - otherLane;
  const dz = policeUnit.pathZ - otherZ;
  const overlapX = policeWidth + otherWidth - Math.abs(dx);
  const overlapZ = policeLength + otherLength - Math.abs(dz);
  if (overlapX <= 0 || overlapZ <= 0) return false;

  // Keep the police car inside the road. If there is no room to resolve
  // sideways (for example, beside a guardrail), resolve front-to-back instead.
  const side = Math.sign(dx) || (policeUnit.offset >= 0 ? 1 : -1);
  const sideTarget = policeUnit.lateral + side * (overlapX + 0.12);
  const canSeparateSideways = sideTarget >= -7.65 && sideTarget <= 7.65;
  if (!keepPolicePlanted && overlapX < overlapZ && canSeparateSideways) {
    policeUnit.lateral = sideTarget;
    policeUnit.lateralVelocity = (policeUnit.lateralVelocity || 0) * 0.25;
  } else {
    const frontBackSide = Math.sign(dz) || 1;
    policeUnit.pathZ += frontBackSide * (overlapZ + 0.12);
    policeUnit.longitudinalVelocity = (policeUnit.longitudinalVelocity || 0) * 0.35;
  }
  return true;
}

function damagePlayer(amount = 3) {
  if (!running || hitCooldown > 0) return;
  playerHealth = Math.max(0, playerHealth - amount);
  hitCooldown = 0.4;
  const value = $('health-value');
  const bar = $('health-bar');
  if (value) value.textContent = `${Math.ceil(playerHealth)}%`;
  if (bar) bar.style.width = `${playerHealth}%`;
  const warning = $('damage-warning');
  if (warning) {
    warning.classList.add('show');
    window.clearTimeout(damagePlayer.warningTimeout);
    damagePlayer.warningTimeout = window.setTimeout(() => warning.classList.remove('show'), 700);
  }
  if (playerHealth <= 0) {
    $('game-over-title').textContent = 'VEHICLE DISABLED!';
    finishGame();
  }
}

function updateHealthDisplay() {
  const value = $('health-value');
  const bar = $('health-bar');
  if (value) value.textContent = `${Math.ceil(playerHealth)}%`;
  if (bar) bar.style.width = `${playerHealth}%`;
}
function spawnRepairPickup() {
  const pickup = new THREE.Group();
  const glow = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.09, 8, 24), new THREE.MeshBasicMaterial({ color: 0x55ff9a, toneMapped: false }));
  glow.rotation.x = Math.PI / 2;
  glow.position.y = 0.35;
  const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.65), material(0xe9f5ed, 0.35, 0.12, { emissive: 0x174a2a }));
  caseMesh.position.y = 0.65;
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.62), new THREE.MeshBasicMaterial({ color: 0x20b85a }));
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.18), new THREE.MeshBasicMaterial({ color: 0x20b85a }));
  crossV.position.set(0, 0.66, 0); crossH.position.set(0, 0.66, 0);
  pickup.add(glow, caseMesh, crossV, crossH);
  const lateral = lanes[Math.floor(Math.random() * lanes.length)];
  const pathZ = -155 - Math.random() * 35;
  placeOnRoad(pickup, lateral, pathZ);
  scene.add(pickup);
  repairPickups.push({ mesh: pickup, lateral, pathZ });
}
function updateRepairPickups(dt) {
  if (!running) return;
  repairSpawnTimer -= dt;
  if (repairSpawnTimer <= 0 && repairPickups.length < 3) {
    spawnRepairPickup();
    repairSpawnTimer = 8 + Math.random() * 5;
  }
  const move = actualSpeed / 3.6 * 2 * dt;
  for (let i = repairPickups.length - 1; i >= 0; i--) {
    const pickup = repairPickups[i];
    pickup.pathZ += move;
    pickup.mesh.rotation.y += dt * 1.2;
    placeOnRoad(pickup.mesh, pickup.lateral, pickup.pathZ);
    if (Math.abs(pickup.pathZ - 7) < 3.2 && Math.abs(pickup.lateral - playerLateral) < 2.1 && playerHealth < 100) {
      playerHealth = Math.min(100, playerHealth + 35);
      updateHealthDisplay();
      scene.remove(pickup.mesh);
      repairPickups.splice(i, 1);
      const toast = $('near-miss');
      if (toast) {
        toast.textContent = 'REPAIR KIT · +35% HEALTH';
        toast.classList.add('show');
        window.clearTimeout(updateRepairPickups.toastTimeout);
        updateRepairPickups.toastTimeout = window.setTimeout(() => toast.classList.remove('show'), 1100);
      }
      playTone(660, 0.16, 'sine', 0.045);
      continue;
    }
    if (pickup.pathZ > 25) {
      scene.remove(pickup.mesh);
      repairPickups.splice(i, 1);
    }
  }
}

function emitPoliceDamageSmoke(unit, dt) {
  if (unit.health >= 200 || unit.disabled) return;
  unit.smokeTimer = Math.max(0, (unit.smokeTimer || 0) - dt);
  if (unit.smokeTimer > 0) return;
  unit.smokeTimer = THREE.MathUtils.lerp(0.22, 0.075, 1 - unit.health / 200);
  const damageRatio = 1 - unit.health / 200;
  const smokeColor = damageRatio < 0.25 ? 0xd9e0e3 :
    damageRatio < 0.5 ? 0x858b91 :
    damageRatio < 0.75 ? 0x45484d : 0x17191d;
  const puff = new THREE.Mesh(
    new THREE.SphereGeometry(0.22 + Math.random() * 0.16, 7, 6),
    new THREE.MeshBasicMaterial({ color: smokeColor, transparent: true, opacity: 0.48, depthWrite: false })
  );
  const exhaustPosition = unit.mesh.localToWorld(new THREE.Vector3(
    (Math.random() - 0.5) * 0.55, 0.95 + Math.random() * 0.25, -1.85
  ));
  puff.position.copy(exhaustPosition);
  scene.add(puff);
  particles.push({
    mesh: puff,
    velocity: new THREE.Vector3((Math.random() - 0.5) * 1.1, 1.2 + Math.random() * 1.2, -0.8 - Math.random() * 0.7),
    life: 1.15 + Math.random() * 0.7,
    maxLife: 1.85,
    smoke: true,
    startScale: puff.scale.x
  });
}

function updatePoliceChase(dt) {
  if (!running) return;
  if (gameMode === 'escape') {
    // Police pursue the player directly instead of forming roadblocks.
    const targetPoliceCount = 4 + Math.floor(score / 300) * 2;
    while (policeChasers.length < targetPoliceCount) {
      const index = policeChasers.length;
      const offset = (index % 2 === 0 ? -1 : 1) * (1.2 + (index % 3) * 0.65);
      spawnPoliceChaser(offset);
    }
    const policeMaxSpeed = Math.min(245, Math.max(180, actualSpeed + 65));
    for (const unit of policeChasers) {
      if (unit.disabled) continue;
      unit.ramCooldown = Math.max(0, (unit.ramCooldown || 0) - dt);
      const phase = Math.floor(performance.now() / 170) % 2;
      if (unit.mesh.userData.policeLightParts) {
        unit.mesh.userData.policeLightParts[0].visible = phase === 0;
        unit.mesh.userData.policeLightParts[1].visible = phase === 1;
      }

      // Police observe the player with a deliberate reaction delay. They
      // do not copy the player's throttle/brake input frame-for-frame.
      unit.observedPlayerSpeed = THREE.MathUtils.damp(
        unit.observedPlayerSpeed || 0, actualSpeed, 0.72, dt
      );
      unit.observedBrake = THREE.MathUtils.damp(
        unit.observedBrake || 0, keys.brake ? 1 : 0, 0.78, dt
      );
      const flankSide = unit.role === 'left' ? -1 : 1;
      const targetLane = THREE.MathUtils.clamp(
        playerLateral + (unit.role === 'left' || unit.role === 'right' ? flankSide * 2.8 : THREE.MathUtils.clamp(unit.offset * 0.22, -1.1, 1.1)),
        -7.2, 7.2
      );
      const desiredLateralVelocity = THREE.MathUtils.clamp((targetLane - unit.lateral) * 1.15, -5.5, 5.5);
      unit.lateralVelocity = THREE.MathUtils.damp(unit.lateralVelocity || 0, desiredLateralVelocity, 1.9, dt);
      unit.lateral += unit.lateralVelocity * dt;
      if (unit.lateral < -7.65 || unit.lateral > 7.65) {
        unit.lateral = THREE.MathUtils.clamp(unit.lateral, -7.65, 7.65);
        unit.lateralVelocity *= -0.18;
      }

      // Catch the player from behind, pass into the lane ahead, then brake
      // hard. The delayed speed/brake observations make the response visibly
      // late instead of perfectly synchronized with the player's controls.
      if (unit.role === 'left' || unit.role === 'right') {
        // Flankers pull alongside and match the player's pace, leaving room
        // for the player to steer away when they settle beside the car.
        if (unit.maneuver !== 'flank' && unit.pathZ <= 9) unit.maneuver = 'flank';
        else if (unit.maneuver === 'flank' && unit.pathZ > 28) unit.maneuver = 'approach';
      } else {
        if (unit.maneuver !== 'brake' && unit.pathZ <= -22) {
          unit.maneuver = 'brake';
        } else if (unit.maneuver === 'brake' && unit.pathZ > 32) {
          unit.maneuver = 'approach';
        }
      }
      const approachSpeed = Math.min(policeMaxSpeed, Math.max(150, unit.observedPlayerSpeed + 65));
      const brakeSpeed = Math.max(100, unit.observedPlayerSpeed - 30 - unit.observedBrake * 8);
      const flankSpeed = THREE.MathUtils.clamp(unit.observedPlayerSpeed - 2, 0, policeMaxSpeed);
      const targetSpeed = Math.min(policeMaxSpeed,
        unit.maneuver === 'flank' ? flankSpeed : unit.maneuver === 'brake' ? brakeSpeed : approachSpeed);
      unit.speed = THREE.MathUtils.damp(unit.speed, targetSpeed,
        unit.maneuver === 'approach' ? 2.4 : 3.0, dt);
      // Relative road motion: faster police move farther ahead; slower police
      // drift back toward the player. This keeps the lead car in front.
      unit.pathZ += (actualSpeed - unit.speed) / 3.6 * 2 * dt;
      // Carry collision momentum through subsequent frames instead of letting
      // pursuit steering erase the impact immediately.
      unit.lateral += (unit.impactVelX || 0) * dt;
      unit.pathZ -= (unit.impactVelZ || 0) * 2 * dt;
      unit.impactVelX = THREE.MathUtils.damp(unit.impactVelX || 0, 0, 1.7, dt);
      unit.impactVelZ = THREE.MathUtils.damp(unit.impactVelZ || 0, 0, 1.7, dt);
      unit.collisionHeading = THREE.MathUtils.clamp((unit.collisionHeading || 0) + (unit.angularVelocity || 0) * dt, -0.48, 0.48);
      unit.angularVelocity = THREE.MathUtils.damp(unit.angularVelocity || 0, 0, 2.0, dt);
      // Police steering angle follows their actual lateral velocity; collision
      // yaw remains separate so the AI can recover without snapping its body.
      const policeHeadingTarget = THREE.MathUtils.clamp(
        Math.atan2(unit.lateralVelocity || 0, Math.max(8, unit.speed / 3.6)), -0.24, 0.24
      );
      unit.steeringHeading = THREE.MathUtils.damp(unit.steeringHeading || 0, policeHeadingTarget, 3.8, dt);
      unit.collisionHeading = THREE.MathUtils.damp(unit.collisionHeading, 0, 1.25, dt);
      // Collision impulses briefly push a cruiser away before its AI regains control.
      unit.lateralVelocity = THREE.MathUtils.damp(unit.lateralVelocity, 0, 0.7, dt);
      unit.longitudinalVelocity = THREE.MathUtils.damp(unit.longitudinalVelocity, 0, 0.85, dt);
      placeOnRoad(unit.mesh, unit.lateral, unit.pathZ, (unit.steeringHeading || 0) + (unit.collisionHeading || 0));
      emitPoliceDamageSmoke(unit, dt);

      // Solid collision against the player: police cars cannot drive through
      // the player's car. The contact nudges the cruiser away and bumps speed.
      const contactDx = playerLateral - unit.lateral;
      const contactDz = unit.pathZ - 7;
      const playerHit = separatePoliceHitbox(
        unit, 7, playerLateral,
        player.userData.collisionHalfWidth || 1.05,
        player.userData.collisionHalfLength || 2.1,
        true
      );
      if (playerHit) {
        damagePlayer(3);
        const selectedSpec = cars.find((car) => car.id === selectedCar) || cars.at(0);
        const requiredSpeed = selectedSpec.maxSpeed * 0.85;
        if (unit.ramCooldown <= 0 && takedownCharge >= 100 && actualSpeed >= requiredSpeed) {
          // Only a fully charged, near-top-speed impact can disable a police car.
          unit.health = 0;
          unit.disabled = true;
          unit.ramCooldown = 1.2;
          scene.remove(unit.mesh);
          awardCredits(15);
          takedownCharge = 0;
          const toast = $('near-miss');
          if (toast) {
            toast.textContent = 'CHARGED TAKEDOWN · +15 CREDITS';
            toast.classList.add('show');
            window.clearTimeout(updatePoliceChase.toastTimeout);
            updatePoliceChase.toastTimeout = window.setTimeout(() => toast.classList.remove('show'), 1100);
          }
        }
        const normalX = contactDx || (unit.offset >= 0 ? -1 : 1);
        const normalZ = contactDz || 0;
        const playerBody = {
          vx: steerVelocity + collisionRecoil, vz: actualSpeed / 3.6,
          omega: collisionAngularVelocity, halfWidth: player.userData.collisionHalfWidth || 1.05,
          halfLength: player.userData.collisionHalfLength || 2.1
        };
        const policeBody = {
          vx: 0,
          vz: unit.speed / 3.6 + (unit.impactVelZ || 0), omega: 0,
          halfWidth: unit.mesh.userData.collisionHalfWidth || 1.08,
          halfLength: unit.mesh.userData.collisionHalfLength || 2.4
        };
        const contact = resolveVehicleImpulse(
          playerBody, policeBody, normalX, normalZ,
          player.userData.massKg || 1750, 9000, 0.06
        );
        steerVelocity += contact.aX;
        actualSpeed = THREE.MathUtils.clamp(actualSpeed + contact.aZ * 3.6, 0, 260);
        unit.impactVelX = 0;
        unit.lateralVelocity = 0;
        unit.impactVelZ = policeBody.vz - unit.speed / 3.6;
        unit.angularVelocity = 0;
        collisionYaw += THREE.MathUtils.clamp(-contact.aX * 0.025, -0.2, 0.2);
        collisionAngularVelocity = playerBody.omega;
        cameraShake = Math.max(cameraShake, 0.22);
        placeOnRoad(unit.mesh, unit.lateral, unit.pathZ, 0);
      }

      // Police cruisers also have solid hitboxes against every normal traffic
      // vehicle and against each other.
      for (const trafficCar of traffic) {
        const dx = unit.lateral - trafficCar.lateralX;
        const dz = trafficCar.pathZ - unit.pathZ;
        const trafficHit = separatePoliceHitbox(
          unit, trafficCar.pathZ, trafficCar.lateralX,
          trafficCar.mesh.userData.collisionHalfWidth || 1.05,
          trafficCar.mesh.userData.collisionHalfLength || 2.1
        );
        if (trafficHit) {
          const policeBody = { vx: (unit.lateralVelocity || 0) + (unit.impactVelX || 0), vz: unit.speed / 3.6 + (unit.impactVelZ || 0), omega: unit.angularVelocity || 0, halfWidth: unit.mesh.userData.collisionHalfWidth || 1.08, halfLength: unit.mesh.userData.collisionHalfLength || 2.4 };
          const trafficBody = { vx: (trafficCar.laneVelocity || 0) + (trafficCar.physicsVelX || 0), vz: trafficCar.botSpeed / 3.6 + (trafficCar.physicsVelZ || 0), omega: trafficCar.angularVelocity || 0, halfWidth: trafficCar.mesh.userData.collisionHalfWidth || 1.05, halfLength: trafficCar.mesh.userData.collisionHalfLength || 2.1 };
          resolveVehicleImpulse(policeBody, trafficBody, dx || (unit.offset >= 0 ? 1 : -1), dz,
            unit.massKg || 1950, trafficCar.mesh.userData.massKg || 1650, 0.1);
          unit.impactVelX = policeBody.vx - (unit.lateralVelocity || 0);
          unit.impactVelZ = policeBody.vz - unit.speed / 3.6;
          unit.angularVelocity = policeBody.omega;
          trafficCar.angularVelocity = trafficBody.omega;
          trafficCar.physicsVelX = trafficBody.vx - (trafficCar.laneVelocity || 0);
          trafficCar.physicsVelZ = THREE.MathUtils.clamp(trafficBody.vz, 0, 92 / 3.6) - trafficCar.botSpeed / 3.6;
        }
      }
      for (const otherPolice of policeChasers) {
        if (otherPolice === unit) break;
        const dx = unit.lateral - otherPolice.lateral;
        const dz = otherPolice.pathZ - unit.pathZ;
        const policeHit = separatePoliceHitbox(
          unit, otherPolice.pathZ, otherPolice.lateral,
          otherPolice.mesh.userData.collisionHalfWidth || 1.08,
          otherPolice.mesh.userData.collisionHalfLength || 2.4
        );
        if (policeHit) {
          const firstBody = { vx: (unit.lateralVelocity || 0) + (unit.impactVelX || 0), vz: unit.speed / 3.6 + (unit.impactVelZ || 0), omega: unit.angularVelocity || 0, halfWidth: unit.mesh.userData.collisionHalfWidth || 1.08, halfLength: unit.mesh.userData.collisionHalfLength || 2.4 };
          const secondBody = { vx: (otherPolice.lateralVelocity || 0) + (otherPolice.impactVelX || 0), vz: otherPolice.speed / 3.6 + (otherPolice.impactVelZ || 0), omega: otherPolice.angularVelocity || 0, halfWidth: otherPolice.mesh.userData.collisionHalfWidth || 1.08, halfLength: otherPolice.mesh.userData.collisionHalfLength || 2.4 };
          resolveVehicleImpulse(firstBody, secondBody, dx || 1, dz, unit.massKg || 1950, otherPolice.massKg || 1950, 0.08);
          unit.impactVelX = firstBody.vx - (unit.lateralVelocity || 0);
          unit.impactVelZ = firstBody.vz - unit.speed / 3.6;
          unit.angularVelocity = firstBody.omega;
          otherPolice.angularVelocity = secondBody.omega;
          otherPolice.impactVelX = secondBody.vx - (otherPolice.lateralVelocity || 0);
          otherPolice.impactVelZ = secondBody.vz - otherPolice.speed / 3.6;
        }
      }
      placeOnRoad(unit.mesh, unit.lateral, unit.pathZ, unit.collisionHeading || 0);

    }
    const activePolice = policeChasers.filter((unit) => !unit.disabled).length;
    const label = $('chase-status');
    if (label) label.textContent = 'POLICE RAMMING PURSUIT · ' + activePolice + ' ACTIVE · EVADE OR RAM BACK!';
  } else {
    const label = $('chase-status');
    if (label) label.textContent = 'VEHICLES STOPPED · ' + arrests + '/5';
    if (player.userData.policeLightParts) {
      const phase = Math.floor(performance.now() / 170) % 2;
      player.userData.policeLightParts[0].visible = phase === 0;
      player.userData.policeLightParts[1].visible = phase === 1;
    }
  }
}
function updateVehicleSignals(vehicle, direction, time) {
  const signals = vehicle?.userData?.turnSignals;
  if (!signals) return;
  const blinking = Math.floor(time / 360) % 2 === 0;
  for (const side of ['left', 'right']) {
    for (const lamp of signals[side] || []) lamp.visible = direction === side && blinking;
  }
}
function updatePlayer(dt) {
const spec = cars.find((car) => car.id === selectedCar) || cars.at(0);
const steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
const drifting = keys.drift && steer !== 0;
const speedMps = actualSpeed / 3.6;
const speedRatio = THREE.MathUtils.clamp(actualSpeed / Math.max(1, spec.maxSpeed), 0, 1.15);
// Responsive arcade steering: input creates controlled lateral acceleration.
// Handling upgrades improve response without multiplying the steering angle
// into extreme values at every speed.
const handlingFactor = THREE.MathUtils.clamp((spec.handling || 8) / 8.5, 0.82, 1.2);
const steeringInputAcceleration = steer * (6.2 + speedRatio * 9.0) * handlingFactor;
if (steer !== 0) {
  steerVelocity += steeringInputAcceleration * dt * (drifting ? 1.18 : 1);
} else {
  steerVelocity = THREE.MathUtils.damp(steerVelocity, 0, drifting ? 1.7 : 4.6, dt);
}
steerVelocity = THREE.MathUtils.clamp(steerVelocity, -9.5, 9.5);
// At a standstill the car should not slide sideways from steering alone.
if (speedMps < 2) steerVelocity = THREE.MathUtils.damp(steerVelocity, 0, 7, dt);
const previousLateral = playerLateral;
playerLateral = THREE.MathUtils.clamp(playerLateral + (steerVelocity + collisionRecoil) * dt, -47, 47);
cityDriving = Math.abs(playerLateral) > 14;
collisionHeading = THREE.MathUtils.clamp(collisionHeading + collisionAngularVelocity * dt, -0.48, 0.48);
// Angular velocity and heading both settle, so a hit can turn the car
// without leaving it permanently crabbed sideways.
collisionAngularVelocity = THREE.MathUtils.damp(collisionAngularVelocity, 0, 2.2, dt);
collisionHeading = THREE.MathUtils.damp(collisionHeading, 0, 1.35, dt);
collisionRecoil = THREE.MathUtils.damp(collisionRecoil, 0, 2.8, dt);
collisionYaw = THREE.MathUtils.damp(collisionYaw, 0, 3.2, dt);
if (Math.abs(playerLateral) >= 46.9) steerVelocity *= 0.35;
const lateralMotion = (playerLateral - previousLateral) / Math.max(dt, 0.001);
const currentSpeedMps = actualSpeed / 3.6;
const previousSpeedMps = player.userData.previousSpeedMps ?? currentSpeedMps;
const longitudinalAcceleration = THREE.MathUtils.clamp(
  (currentSpeedMps - previousSpeedMps) / Math.max(dt, 0.001), -9, 6
);
player.userData.previousSpeedMps = currentSpeedMps;
// Vehicle heading follows its actual lateral motion. This avoids the
// sideways-crab look and lets counter-steering naturally correct a slide.
const steeringYawTarget = THREE.MathUtils.clamp(
  Math.atan2(steerVelocity, Math.max(4, speedMps)),
  -0.30,
  0.30
);
const steeringYaw = THREE.MathUtils.damp(
  player.userData.steeringYaw || 0,
  steeringYawTarget,
  drifting ? 3.2 : 6.0,
  dt
);
player.userData.steeringYaw = steeringYaw;
placeOnRoad(player, playerLateral, 7, steeringYaw + collisionHeading);
const bodyRollTarget = THREE.MathUtils.clamp(
  -lateralMotion * 0.018 * (drifting ? 1.35 : 1) + collisionYaw,
  -0.16, 0.16
);
player.rotation.z = THREE.MathUtils.damp(player.rotation.z, bodyRollTarget, drifting ? 3.8 : 4.6, dt);
updateVehicleSignals(player, steer < 0 ? 'left' : steer > 0 ? 'right' : null, performance.now());
player.userData.body.position.y = player.userData.bodyBaseY
  + Math.sin(performance.now() * 0.008) * Math.min(0.012, actualSpeed / 24000)
  + THREE.MathUtils.clamp(-longitudinalAcceleration * 0.004, -0.035, 0.045);
player.userData.body.rotation.x = THREE.MathUtils.damp(
  player.userData.body.rotation.x || 0,
  THREE.MathUtils.clamp(-longitudinalAcceleration * 0.004, -0.035, 0.045), 4.5, dt
);
const lateralAcceleration = (steerVelocity - (player.userData.previousLateralVelocity || 0)) / Math.max(dt, 0.001);
player.userData.previousLateralVelocity = steerVelocity;
player.userData.body.rotation.z = THREE.MathUtils.damp(
  player.userData.body.rotation.z || 0,
  THREE.MathUtils.clamp(-lateralAcceleration * 0.0085, -0.12, 0.12), 4.2, dt
);
for (const wheel of player.userData.wheels) wheel.rotation.x += actualSpeed / 3.6 * dt * 0.85;
}
function updateTraffic(dt, previousPlayer) {
  if (!running) return;
  if (hitCooldown > 0) hitCooldown -= dt;

  if (burstTimer > 0) burstTimer -= dt;
  else if ((burstCooldown -= dt) <= 0) {
    burstTimer = 4 + Math.random() * 3;
    burstCooldown = 13 + Math.random() * 14;
    spawnTimer = 0;
  }
  // Maintain an even stream of traffic across several distance bands.
  const difficulty = Math.min(8, Math.floor(score / 900));
  const trafficLimit = Math.min(20, 14 + difficulty);
  const desiredTrafficAhead = Math.min(13, 9 + Math.floor(difficulty / 2));
  const trafficAhead = traffic.filter((item) => item.pathZ < -35).length;
  spawnTimer -= dt;
  if (spawnTimer <= 0 && trafficAhead < desiredTrafficAhead && traffic.length < trafficLimit) {
    const spawned = spawnTraffic();
    // Retry quickly only when every lane/band is occupied; otherwise keep a
    // measured interval so traffic arrives in a steady, readable flow.
    spawnTimer = spawned ? 0.42 + Math.random() * 0.28 : 0.18;
  }

  const oldPositions = new Map(traffic.map((item) => [item, {
    z: item.pathZ,
    lateral: item.lateralX
  }]));
  const playerMps = actualSpeed / 3.6 * 2;

  for (const item of traffic) {
    item.collisionCooldown = Math.max(0, (item.collisionCooldown || 0) - dt);
    if (item.mesh.userData.policeLights) {
      const phase=Math.floor(performance.now()/220)%2;
      item.mesh.userData.policeLights[0].visible=phase===0;
      item.mesh.userData.policeLights[1].visible=phase===1;
    }
    if (item.isTarget && item.mesh.userData.targetBeacon) {
      const beacon = item.mesh.userData.targetBeacon;
      beacon.rotation.y += dt * 1.8;
      const pulse = 0.72 + Math.sin(performance.now() * 0.008) * 0.28;
      beacon.scale.setScalar(pulse);
    }
    // Civilian traffic uses predictive following: check the space ahead,
    // signal before changing lanes, and smoothly return to a stable lane.
    if (!item.oncoming) {
      item.laneChangeCooldown = Math.max(0, item.laneChangeCooldown - dt);

      const laneOptions = roadMode === 'one-way' ? lanes : lanes.slice(2);
      const findLeader = (lane, range = 75) => traffic
        .filter((other) => other !== item && !other.oncoming &&
          Math.abs(other.lane - lane) < 0.2 && other.pathZ < item.pathZ &&
          item.pathZ - other.pathZ < range)
        .sort((a, b) => b.pathZ - a.pathZ)[0] || null;
      const leader = findLeader(item.targetLane);
      const gap = leader ? item.pathZ - leader.pathZ : Infinity;
      const desiredGap = 18 + item.botSpeed * 0.12;

      // If a slower car is ahead, choose a lane only when the full merge area
      // is clear both ahead and behind. Otherwise brake smoothly and wait.
      if (leader && gap < desiredGap + 18 && item.laneChangeCooldown <= 0) {
        const alternatives = laneOptions
          .filter((candidate) => Math.abs(candidate - item.targetLane) > 0.1)
          .map((candidate) => {
            const nearby = traffic.filter((other) => other !== item && !other.oncoming &&
              Math.abs(other.lane - candidate) < 0.2);
            const ahead = nearby.filter((other) => other.pathZ < item.pathZ)
              .reduce((best, other) => Math.min(best, item.pathZ - other.pathZ), Infinity);
            const behind = nearby.filter((other) => other.pathZ > item.pathZ)
              .reduce((best, other) => Math.min(best, other.pathZ - item.pathZ), Infinity);
            return { lane: candidate, score: Math.min(ahead, 90) + Math.min(behind, 55) * 0.65,
              safe: ahead > desiredGap + 12 && behind > 24 };
          })
          .filter((option) => option.safe)
          .sort((a, b) => b.score - a.score);
        if (alternatives.length && item.drivingStyle > 0.18) {
          item.targetLane = alternatives[0].lane;
          item.laneChangeCooldown = 4.5 + Math.random() * 3;
          item.mesh.userData.signalUntil = performance.now() + 650;
        }
      }


      const cruise = THREE.MathUtils.clamp(78 + (item.paceOffset || 0) * 0.2, 72, 90);
      const followTarget = leader && gap < desiredGap
        ? Math.max(42, leader.botSpeed - (desiredGap - gap) * 1.25)
        : cruise;
      const targetSpeed = Math.min(cruise, followTarget);
      item.botSpeed = THREE.MathUtils.clamp(
        THREE.MathUtils.damp(item.botSpeed, targetSpeed, targetSpeed < item.botSpeed ? 2.4 : 1.15, dt),
        0, 92
      );

      const previousLateral = item.lateralX;
      item.lateralX = THREE.MathUtils.damp(item.lateralX, item.targetLane, 1.05, dt);
      item.laneVelocity = (item.lateralX - previousLateral) / Math.max(dt, 0.001);
      const steerTarget = THREE.MathUtils.clamp(
        Math.atan2(-item.laneVelocity, Math.max(9, item.botSpeed / 3.6)), -0.16, 0.16
      );
      item.mesh.userData.laneSteer = THREE.MathUtils.damp(item.mesh.userData.laneSteer || 0, steerTarget, 2.2, dt);
      const signalDirection = item.targetLane < item.lateralX - 0.16 ? 'left' :
        item.targetLane > item.lateralX + 0.16 ? 'right' : null;
      updateVehicleSignals(item.mesh, signalDirection, performance.now());
    } else {
      // Oncoming cars keep a predictable speed and never use same-direction
      // lane-change logic.
      item.botSpeed = THREE.MathUtils.clamp(
        THREE.MathUtils.damp(item.botSpeed, 82 + (item.paceOffset || 0) * 0.2, 1.0, dt), 72, 92
      );
    }

    // Keep the base speed and collision carry velocity inside a hard traffic cap.
    item.botSpeed = THREE.MathUtils.clamp(item.botSpeed, 0, 92);
    item.physicsVelZ = THREE.MathUtils.clamp(item.physicsVelZ || 0,
      -item.botSpeed / 3.6, (92 - item.botSpeed) / 3.6);
    const botMps = item.botSpeed / 3.6 * 2;
    item.pathZ += (item.oncoming ? playerMps + botMps : playerMps - botMps) * dt;
    // Collision impulses are persistent velocity, not one-frame position snaps.
    item.pathZ -= (item.physicsVelZ || 0) * 2 * dt;
    item.physicsVelZ = THREE.MathUtils.damp(item.physicsVelZ || 0, 0, 1.25, dt);
    item.lateralX += (item.laneVelocity || 0) * 0 + (item.physicsVelX || 0) * dt;
    item.physicsVelX = THREE.MathUtils.damp(item.physicsVelX || 0, 0, 1.45, dt);
    item.collisionHeading = THREE.MathUtils.clamp((item.collisionHeading || 0) + (item.angularVelocity || 0) * dt, -0.5, 0.5);
    item.angularVelocity = THREE.MathUtils.damp(item.angularVelocity || 0, 0, 2.1, dt);
    // Let traffic straighten after a collision instead of keeping a permanent yaw.
    item.collisionHeading = THREE.MathUtils.damp(item.collisionHeading, 0, 1.25, dt);
    for (const wheel of (item.mesh.userData.wheels || [])) {
      wheel.rotation.x += item.botSpeed / 3.6 * dt;
    }
  }

  const laneGroups = new Map();
  for (const item of traffic) {
    if (!laneGroups.has(item.lane)) laneGroups.set(item.lane, []);
    laneGroups.get(item.lane).push(item);
  }
  for (const group of laneGroups.values()) {
    group.sort((a, b) => oldPositions.get(b).z - oldPositions.get(a).z);
    for (let index = 1; index < group.length; index++) {
      const leader = group[index - 1];
      const follower = group[index];
      const safeGap = (leader.mesh.userData.collisionHalfLength || 2.2) + (follower.mesh.userData.collisionHalfLength || 2.2) + 2.5;
      const gap = follower.pathZ - leader.pathZ;
      if (gap < safeGap) {
        const followerBody = { vx: (follower.laneVelocity || 0) + (follower.physicsVelX || 0), vz: follower.botSpeed / 3.6 + (follower.physicsVelZ || 0) };
        const leaderBody = { vx: (leader.laneVelocity || 0) + (leader.physicsVelX || 0), vz: leader.botSpeed / 3.6 + (leader.physicsVelZ || 0) };
        resolveVehicleImpulse(followerBody, leaderBody, 0, -1,
          follower.mesh.userData.massKg || 1650, leader.mesh.userData.massKg || 1650, 0.1);
        follower.physicsVelZ = THREE.MathUtils.clamp(followerBody.vz, 0, 92 / 3.6) - follower.botSpeed / 3.6;
        leader.physicsVelZ = THREE.MathUtils.clamp(leaderBody.vz, 0, 92 / 3.6) - leader.botSpeed / 3.6;
        follower.pathZ = leader.pathZ + safeGap;
      }
    }
  }
  // Convert each bot's lane-relative position onto the same curved centerline.
  for (const item of traffic) {
    const headingOffset = item.baseHeading + item.trafficDirectionOffset;
    placeOnRoad(item.mesh, item.lateralX, item.pathZ, headingOffset + (item.mesh.userData.laneSteer || 0) + (item.collisionHeading || 0));
  }

  for (let index = traffic.length - 1; index >= 0; index--) {
    const item = traffic[index];
    const newZ = item.pathZ;
    const oldState = oldPositions.get(item);
    const prevRelZ = oldState.z - previousPlayer.z;
    const nextRelZ = newZ - 7;
    const playerHalfLength = (player.userData.collisionHalfLength || 2.1) * 0.88;
    const botHalfLength = (item.mesh.userData.collisionHalfLength || 2.1) * 0.88;
    const playerHalfWidth = (player.userData.collisionHalfWidth || 1.05) * 0.9;
    const botHalfWidth = (item.mesh.userData.collisionHalfWidth || 1.05) * 0.9;
    const combinedLength = playerHalfLength + botHalfLength;
    const combinedWidth = playerHalfWidth + botHalfWidth;
    const dxStart = previousPlayer.x - oldState.lateral;
    const dxEnd = player.position.x - item.lateralX;
    const dzStart = prevRelZ;
    const dzEnd = nextRelZ;
    let collision = false;
    let closestDistance = Infinity;
    let closestDx = 0;

    // Sweep the two car hit areas through the frame so fast vehicles cannot
    // tunnel through each other between updates. An ellipse fits car corners
    // more closely than the old oversized axis-aligned rectangle.
    for (let sample = 0; sample <= 6; sample++) {
      const t = sample / 6;
      const dx = THREE.MathUtils.lerp(dxStart, dxEnd, t);
      const dz = THREE.MathUtils.lerp(dzStart, dzEnd, t);
      const normalized = (dx * dx) / (combinedWidth * combinedWidth) +
        (dz * dz) / (combinedLength * combinedLength);
      if (normalized < closestDistance) {
        closestDistance = normalized;
        closestDx = Math.abs(dx);
      }
      if (normalized <= 1) {
        collision = true;
        break;
      }
    }
    const dx = closestDx;

    if (collision && item.collisionCooldown <= 0) {
      if (gameMode === 'police' && item.isTarget) {
        arrests++;
        awardCredits(20);
        scene.remove(item.mesh);
        traffic.splice(index,1);
        const toast=$('near-miss');
        toast.textContent='TARGET STOPPED · +20';
        toast.classList.add('show');
        window.clearTimeout(updateTraffic.damageTimeout);
        updateTraffic.damageTimeout=window.setTimeout(()=>toast.classList.remove('show'),850);
        if(arrests>=5){$('game-over-title').textContent='SHIFT COMPLETE!';finishGame();return;}
        continue;
      }
      item.collisionCooldown = 0.18;
      damagePlayer(3);
      // A traffic impact pushes the cars apart and slows the player instead
      // of deleting the traffic car, so the vehicles visibly bump.
      const side = Math.sign(dxStart + dxEnd) || 1;
      const longitudinalSide = Math.sign(newZ - 7) || 1;
      // Use the axis with the deeper overlap as the contact normal. This
      // avoids diagonal impulses when the cars are really hitting side-on
      // or nose-to-tail.
      const overlapX = combinedWidth - Math.abs(dxStart + dxEnd) * 0.5;
      const overlapZ = combinedLength - Math.abs((prevRelZ + nextRelZ) * 0.5);
      const avgDx = (dxStart + dxEnd) * 0.5;
      const avgDz = (prevRelZ + nextRelZ) * 0.5;
      const ellipseNx = avgDx / (combinedWidth * combinedWidth);
      const ellipseNz = avgDz / (combinedLength * combinedLength);
      const normalLength = Math.hypot(ellipseNx, ellipseNz) || 1;
      const normalX = ellipseNx / normalLength;
      const normalZ = ellipseNz / normalLength;
      // Solve the contact using both cars' masses and relative velocity.
      const playerBody = { vx: steerVelocity + collisionRecoil, vz: actualSpeed / 3.6, omega: collisionAngularVelocity, halfWidth: playerHalfWidth, halfLength: playerHalfLength };
      const trafficBody = {
        vx: item.laneVelocity + (item.physicsVelX || 0),
        vz: item.botSpeed / 3.6 + (item.physicsVelZ || 0), omega: item.angularVelocity || 0,
        halfWidth: botHalfWidth, halfLength: botHalfLength
      };
      const contact = resolveVehicleImpulse(
        playerBody, trafficBody, normalX, normalZ,
        player.userData.massKg || 1750, item.mesh.userData.massKg || 1650,
        item.oncoming ? 0.16 : 0.20
      );
      // Separate the bodies by the smallest overlap axis, then let their
      // post-impact velocities carry them apart over subsequent frames.
      if (overlapX < overlapZ) {
        item.lateralX = THREE.MathUtils.clamp(playerLateral - normalX * (combinedWidth + 0.14), -8.2, 8.2);
      } else {
        item.pathZ = 7 + longitudinalSide * (combinedLength + 0.14);
      }
      item.physicsVelX = trafficBody.vx - item.laneVelocity;
      item.physicsVelZ = THREE.MathUtils.clamp(trafficBody.vz, 0, 92 / 3.6) - item.botSpeed / 3.6;
      item.angularVelocity = trafficBody.omega;
      collisionAngularVelocity = playerBody.omega;
      item.targetLane = item.lane = item.lateralX;
      steerVelocity = playerBody.vx;
      actualSpeed = THREE.MathUtils.clamp(playerBody.vz * 3.6, 0, 260);
      collisionYaw += THREE.MathUtils.clamp(-contact.aX * 0.025, -0.18, 0.18);
      // Stronger lateral recoil makes a high-speed hit visibly throw the player car sideways.
      collisionRecoil = THREE.MathUtils.clamp(collisionRecoil + contact.aX * 1.15, -12, 12);
      placeOnRoad(item.mesh, item.lateralX, item.pathZ,
        item.baseHeading + item.trafficDirectionOffset + (item.mesh.userData.laneSteer || 0) + (item.collisionHeading || 0));
      cameraShake = Math.max(cameraShake, THREE.MathUtils.clamp(0.35 + contact.impulse / 18000, 0.35, 1.25));
      steerVelocity += -side * 1.1;
      addSparks(player.position.clone().add(new THREE.Vector3(0,0.7,-1.6)),9);
      const warning=$('damage-warning');
      warning.classList.add('show');
      window.clearTimeout(updateTraffic.damageTimeout);
      updateTraffic.damageTimeout=window.setTimeout(()=>warning.classList.remove('show'),700);
      continue;
    }

    if (!item.checkedMiss && prevRelZ < 0 && nextRelZ >= 0) {
      item.checkedMiss = true;
      if (dx > 1.9 && dx < 3.3) showNearMiss();
      else if (dx >= 3.3) nearMissChain = 0;
    }

    if (newZ > 24 || newZ < -300) {
      scene.remove(item.mesh);
      traffic.splice(index, 1);
    }
  }
}


// --- Open city driving world -------------------------------------------------
// The legacy scrolling highway remains available as a fallback, but the escape
// mode now runs on a real world-space street grid.
// Build lightweight, invisible box colliders from individual GLB meshes.
// A spatial hash keeps collision checks local instead of scanning the whole city.
const CITY_COLLISION_CELL = 24;
let cityCollisionGrid = new Map();
let cityCollisionCount = 0;
let citySpawnPosition = new THREE.Vector3(0, 0, 0);
function buildCityCollisionGrid(root) {
  cityCollisionGrid.clear();
  cityCollisionCount = 0;
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  const addToCell = (key, collider) => {
    let bucket = cityCollisionGrid.get(key);
    if (!bucket) cityCollisionGrid.set(key, bucket = []);
    bucket.push(collider);
  };
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry) return;
    bounds.setFromObject(object);
    if (bounds.isEmpty()) return;
    bounds.getSize(size);
    bounds.getCenter(center);
    // Ignore terrain slabs, road surfaces, tiny props and giant combined meshes.
    if (size.y < 1.25 || size.x < 0.8 || size.z < 0.8) return;
    if (size.x > 90 || size.z > 90 || size.y > 180) return;
    const collider = {
      minX: bounds.min.x, maxX: bounds.max.x,
      minY: bounds.min.y, maxY: bounds.max.y,
      minZ: bounds.min.z, maxZ: bounds.max.z
    };
    const minCellX = Math.floor(collider.minX / CITY_COLLISION_CELL);
    const maxCellX = Math.floor(collider.maxX / CITY_COLLISION_CELL);
    const minCellZ = Math.floor(collider.minZ / CITY_COLLISION_CELL);
    const maxCellZ = Math.floor(collider.maxZ / CITY_COLLISION_CELL);
    for (let x = minCellX; x <= maxCellX; x++) {
      for (let z = minCellZ; z <= maxCellZ; z++) {
        addToCell(x + ',' + z, collider);
      }
    }
    cityCollisionCount++;
  });
  console.info('Generated simplified city hitboxes:', cityCollisionCount);
}
function findCityRoadsideSpawn(root) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((object) => {
    if (object.isMesh && object.geometry) meshes.push(object);
  });
  if (!meshes.length) return new THREE.Vector3(0, 0, 0);
  const mapBounds = new THREE.Box3().setFromObject(root);
  const mapSize = mapBounds.getSize(new THREE.Vector3());
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  const normalMatrix = new THREE.Matrix3();
  let best = null;
  let bestScore = Infinity;
  // Only test a small local grid. The old 2,116 full-city raycasts caused
  // a major loading freeze on large city GLBs.
  const rayStartY = mapBounds.max.y + 10;
  raycaster.far = mapSize.y + 30;
  for (let x = -40; x <= 40; x += 10) {
    for (let z = -40; z <= 40; z += 10) {
      origin.set(x, rayStartY, z);
      raycaster.set(origin, down);
      const hits = raycaster.intersectObjects(meshes, false);
      for (const hit of hits) {
        if (!hit.face || hit.point.y < -1 || hit.point.y > 12) continue;
        normalMatrix.getNormalMatrix(hit.object.matrixWorld);
        const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
        if (Math.abs(normal.y) < 0.88) continue;
        if (cityPositionBlocked(x, z, hit.point.y)) continue;
        const score = Math.hypot(x, z);
        if (score < bestScore) {
          bestScore = score;
          best = new THREE.Vector3(x, Math.max(0, hit.point.y), z);
        }
        break;
      }
    }
  }
  if (best) {
    console.info('Selected clear roadside spawn:', best.toArray());
    return best;
  }
  console.warn('No clear road surface found near the map centre; using a low fallback spawn.');
  return new THREE.Vector3(0, 0, 0);
}

function cityPositionBlocked(x, z, groundY = citySpawnPosition.y) {
  const cellX = Math.floor(x / CITY_COLLISION_CELL);
  const cellZ = Math.floor(z / CITY_COLLISION_CELL);
  const radius = 2.2;
  const carMinY = 0.15;
  const carMaxY = 2.4;
  for (let gx = cellX - 1; gx <= cellX + 1; gx++) {
    for (let gz = cellZ - 1; gz <= cellZ + 1; gz++) {
      const bucket = cityCollisionGrid.get(gx + ',' + gz);
      if (!bucket) continue;
      for (const box of bucket) {
        if (box.maxY < groundY + carMinY || box.minY > groundY + carMaxY) continue;
        if (x + radius > box.minX && x - radius < box.maxX &&
            z + radius > box.minZ && z - radius < box.maxZ) return true;
      }
    }
  }
  return false;
}

function createOpenCityWorld() {
  if (cityWorldReady) return;
  cityWorldReady = true;
  for (const object of [...roads, ...scenery, ...grounds]) object.visible = false;
  cityBuildingGrid = new Map();
  cityRoot = new THREE.Group();
  cityRoot.name = 'san_francisco_city_map';
  scene.add(cityRoot);

  // Load the user's San Francisco city map from Git LFS. The model is centered
  // on the driving world and scaled to fit the existing city coordinate space.
  const mapUrl = 'https://media.githubusercontent.com/media/IM2SKIBIDI4U/Traffic-Racer-2.o/main/Castelia%20City.glb';
  gltfLoader.load(mapUrl, (gltf) => {
    const map = gltf.scene;
    map.name = 'SanFrancisco_City';
    map.updateMatrixWorld(true);
    // GLB/glTF scenes are Y-up by specification. Do not auto-rotate based
    // on bounding-box proportions: city footprints can trigger false positives.
    map.rotation.set(0, 0, 0);
    map.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(map);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const horizontalSize = Math.max(size.x, size.z);
    if (!Number.isFinite(horizontalSize) || horizontalSize < 0.01) {
      console.error('SanFrancisco_City.glb has invalid dimensions.');
      return;
    }
    const mapScale = 1400 / horizontalSize;
    map.scale.setScalar(mapScale);
    map.position.set(-center.x * mapScale, -bounds.min.y * mapScale, -center.z * mapScale);
    map.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = false;
        object.receiveShadow = false;
        object.frustumCulled = true;
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const mat of materials) {
            if (mat) {
              mat.side = THREE.DoubleSide;
              mat.needsUpdate = true;
            }
          }
        }
      }
    });
    cityRoot.add(map);
    buildCityCollisionGrid(map);
    citySpawnPosition.copy(findCityRoadsideSpawn(map));
    console.info('Castelia City map loaded with simplified hitboxes.', {size: size.toArray(), scale: mapScale, hitboxes: cityCollisionCount});
  }, (event) => {
    if (event.total) console.info('Loading San Francisco map:', Math.round(event.loaded / event.total * 100) + '%');
  }, (error) => {
    console.error('Could not load SanFrancisco_City.glb:', error);
    const warning = document.createElement('div');
    warning.textContent = 'CITY MAP FAILED TO LOAD · CHECK THE GLB FILE';
    Object.assign(warning.style, {position:'fixed',top:'58px',left:'50%',transform:'translateX(-50%)',zIndex:'50',padding:'9px 13px',borderRadius:'7px',background:'rgba(90,20,20,.9)',color:'#fff',font:'700 12px Arial,sans-serif',pointerEvents:'none'});
    document.body.appendChild(warning);
  });
}
function cityRoadPosition(position) {
  const gx=Math.round(position.x/CITY_BLOCK)*CITY_BLOCK;
  const gz=Math.round(position.z/CITY_BLOCK)*CITY_BLOCK;
  const onVertical=Math.abs(position.x-gx)<CITY_BLOCK*0.5;
  const onHorizontal=Math.abs(position.z-gz)<CITY_BLOCK*0.5;
  return onVertical || onHorizontal;
}
function spawnCityTraffic() {
  if(cityTraffic.length>=18)return;
  const mesh=createCar([0xd9dfe2,0x273b52,0x7b858b,0x9b3f32,0xe0e0d8][Math.floor(Math.random()*5)],false,Math.floor(Math.random()*4));
  const axis=Math.random()<0.5?'x':'z';
  const sign=Math.random()<0.5?-1:1;
  const road=Math.round((Math.random()*12-6))*CITY_BLOCK;
  const lane=(Math.random()<0.5?-1:1)*3.8;
  mesh.position.set(axis==='x'?player.position.x+(Math.random()-0.5)*180:road+lane,0,axis==='z'?player.position.z+(Math.random()-0.5)*180:road);
  mesh.rotation.y=axis==='x'?(sign>0?Math.PI/2:-Math.PI/2):(sign>0?0:Math.PI);
  scene.add(mesh);
  cityTraffic.push({mesh,axis,sign,speed:13+Math.random()*9,turnAt:0,turnCooldown:4});
}
function spawnCityPolice() {
  if(cityPolice.filter(p=>!p.disabled).length>=6)return;
  const mesh=createCar(0x172b46,false,2);
  mesh.userData.isPolice=true;
  addPoliceLightbar(mesh);
  // Spawn well behind the camera's view, on a nearby street.
  const angle=cityHeading+Math.PI;
  const spawn=player.position.clone().add(new THREE.Vector3(Math.sin(angle)*55,0,Math.cos(angle)*55));
  const axis=Math.abs(spawn.x-player.position.x)>=Math.abs(spawn.z-player.position.z)?'x':'z';
  const lane=(Math.random()<0.5?-1:1)*3.8;
  if(axis==='x') {
    const roadZ=Math.round(spawn.z/CITY_BLOCK)*CITY_BLOCK;
    mesh.position.set(spawn.x,0,roadZ+lane);
  } else {
    const roadX=Math.round(spawn.x/CITY_BLOCK)*CITY_BLOCK;
    mesh.position.set(roadX+lane,0,spawn.z);
  }
  const sign=axis==='x'?(player.position.x>=mesh.position.x?1:-1):(player.position.z>=mesh.position.z?1:-1);
  mesh.rotation.y=axis==='x'?(sign>0?Math.PI/2:-Math.PI/2):(sign>0?0:Math.PI);
  scene.add(mesh);
  // Cruisers enter the pursuit already moving so the player is not waiting
  // for them to accelerate from a standstill.
  cityPolice.push({mesh,axis,sign,lane,speed:29,health:200,disabled:false,ramCooldown:0,turnCooldown:0,lastJunction:NaN});
}
function spawnCityRepairPickup() {
  if(cityRepairPickups.length>=3)return;
  const kit=new THREE.Group();
  const green=new THREE.MeshStandardMaterial({color:0x35d66b,emissive:0x0d5b24,emissiveIntensity:0.55});
  const vertical=new THREE.Mesh(new THREE.BoxGeometry(0.42,1.25,0.28),green);
  const horizontal=new THREE.Mesh(new THREE.BoxGeometry(1.05,0.38,0.28),green);
  kit.add(vertical,horizontal);
  const nearestX=Math.round(player.position.x/CITY_BLOCK)*CITY_BLOCK;
  const nearestZ=Math.round(player.position.z/CITY_BLOCK)*CITY_BLOCK;
  if(Math.random()<0.5)kit.position.set(nearestX+(Math.random()<0.5?-4:4),1,player.position.z+(Math.random()-0.5)*100);
  else kit.position.set(player.position.x+(Math.random()-0.5)*100,1,nearestZ+(Math.random()<0.5?-4:4));
  kit.userData.rotationSpeed=1.4;
  scene.add(kit);
  cityRepairPickups.push(kit);
}
function cityVehicleCollision(mesh, other, speed) {
  const dx=mesh.position.x-other.position.x, dz=mesh.position.z-other.position.z;
  const distance=Math.hypot(dx,dz);
  const hitRadius=other.userData.isPolice?2.5:3.5;
  if(distance>hitRadius || distance<0.001)return false;
  const nx=dx/distance,nz=dz/distance;
  mesh.position.x+=nx*(hitRadius-distance)*0.55;
  mesh.position.z+=nz*(hitRadius-distance)*0.55;
  other.position.x-=nx*(hitRadius-distance)*0.45;
  other.position.z-=nz*(hitRadius-distance)*0.45;
  mesh.userData.cityImpact=(mesh.userData.cityImpact||0)+Math.min(12,speed*0.22);
  other.userData.cityImpact=(other.userData.cityImpact||0)+Math.min(8,speed*0.14);
  return true;
}
let cityMinimap = null;
let cityMinimapTimer = 0;
function updateCityMinimap(dt) {
  cityMinimapTimer -= dt;
  if (cityMinimapTimer > 0) return;
  cityMinimapTimer = 0.09;
  if (!cityMinimap) {
    cityMinimap = document.createElement('canvas');
    cityMinimap.id = 'city-minimap';
    cityMinimap.width = 192;
    cityMinimap.height = 192;
    Object.assign(cityMinimap.style, {
      position: 'fixed', top: '14px', right: '14px', width: 'min(176px, 34vw)',
      height: 'min(176px, 34vw)', zIndex: '40', borderRadius: '12px',
      border: '2px solid rgba(220,235,245,.72)', background: 'rgba(5,12,20,.88)',
      boxShadow: '0 5px 22px rgba(0,0,0,.42)', pointerEvents: 'none'
    });
    document.body.appendChild(cityMinimap);
  }
  const ctx = cityMinimap.getContext('2d');
  if (!ctx || !player) return;
  const cx = 96, cy = 96, scale = 0.39, heading = cityHeading;
  ctx.clearRect(0, 0, 192, 192);
  ctx.fillStyle = 'rgba(7,17,27,.94)';
  ctx.fillRect(0, 0, 192, 192);
  ctx.strokeStyle = 'rgba(120,150,165,.22)';
  ctx.lineWidth = 1;
  for (const radius of [28, 56, 84]) {
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
  }
  // Faint street grid, rotated so the player's direction always points up.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-heading);
  ctx.strokeStyle = 'rgba(160,180,190,.18)';
  ctx.lineWidth = 5;
  for (let n = -4; n <= 4; n++) {
    const p = n * CITY_BLOCK * scale;
    ctx.beginPath(); ctx.moveTo(p, -100); ctx.lineTo(p, 100); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-100, p); ctx.lineTo(100, p); ctx.stroke();
  }
  ctx.restore();
  // Police markers are positioned relative to the player and map heading.
  for (const cop of cityPolice) {
    if (cop.disabled || !cop.mesh) continue;
    const dx = cop.mesh.position.x - player.position.x;
    const dz = cop.mesh.position.z - player.position.z;
    const right = dx * Math.cos(heading) - dz * Math.sin(heading);
    const forward = dx * Math.sin(heading) + dz * Math.cos(heading);
    const x = cx + right * scale, y = cy - forward * scale;
    if (x < 5 || x > 187 || y < 5 || y > 187) continue;
    ctx.fillStyle = '#ff4b50';
    ctx.beginPath(); ctx.arc(x, y, 5.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.3; ctx.stroke();
  }
  // Drag-race start/finish markers and business locations are shown on the minimap.
  const drawMapMarker=(wx,wz,color,label)=>{
    const dx=wx-player.position.x,dz=wz-player.position.z;
    const right=dx*Math.cos(heading)-dz*Math.sin(heading);
    const forward=dx*Math.sin(heading)+dz*Math.cos(heading);
    const x=cx+right*0.20,y=cy-forward*0.20;
    if(x<7||x>185||y<7||y>185)return;
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.stroke();
    ctx.font='bold 7px Arial';ctx.fillStyle=color;ctx.fillText(label,x+6,y-5);
  };
  drawMapMarker(-0,-520,'#35e69a','RACE');
  drawMapMarker(0,-220,'#ffd34d','FINISH');
  for(const place of cityBusinessLocations)drawMapMarker(place.x,place.z,'#ff9b4a','JOB');
  // Player marker always stays in the middle and points toward the top.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#45d9ff';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.font = 'bold 10px Arial';
  ctx.fillStyle = '#45d9ff'; ctx.fillText('YOU', 8, 15);
  ctx.fillStyle = '#a9c5d5'; ctx.fillText('CITY', 42, 15);
}
function attemptCityRobbery() {
  if (!player || !running) return false;
  const place = cityBusinessLocations.find(p => Math.hypot(player.position.x - p.x, player.position.z - p.z) < 13);
  if (!place) return false;
  const reward = place.name === 'BANK' ? 500 : place.name === 'JEWELRY SHOP' ? 300 : 120;
  awardCredits(reward);
  cityWantedLevel = Math.min(5, Math.max(2, cityWantedLevel + 1));
  cityLawbreakingTime = 0;
  if (cityCrimeHud) {
    cityCrimeHud.style.display = 'block';
    cityCrimeHud.textContent = 'WANTED ' + '★'.repeat(cityWantedLevel);
  }
  if (dragRaceHud) {
    dragRaceHud.style.display = 'block';
    dragRaceHud.textContent = place.name + ' · +$' + reward;
  }
  return true;
}
function startDragRace() {
  if (dragRaceActive || !player || Math.abs(player.position.x) > 8 || Math.abs(player.position.z + 520) > 9 || Math.cos(cityHeading) < 0.7) return;
  dragRaceActive = true;
  dragRaceTime = 0;
  dragRaceOpponentSpeed = 0;
  if (!dragRaceOpponent) dragRaceOpponent = createCar(0xe3a52f, false, 1);
  dragRaceOpponent.position.set(4.25, 0, -525);
  dragRaceOpponent.rotation.set(0, 0, 0);
  dragRaceOpponent.visible = true;
  if (!dragRaceOpponent.parent) scene.add(dragRaceOpponent);
  if (!dragRaceHud) {
    dragRaceHud = document.createElement('div');
    Object.assign(dragRaceHud.style, {
      position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)',
      zIndex: '45', padding: '12px 20px', background: 'rgba(5,13,22,.9)',
      color: 'white', font: 'bold 22px Arial', borderRadius: '10px'
    });
    document.body.appendChild(dragRaceHud);
  }
  dragRaceHud.style.display = 'block';
  dragRaceHud.textContent = 'DRAG RACE · GO!';
}
function updateDragRace(dt) {
  if(!dragRaceActive) return;
  dragRaceTime+=dt;
  dragRaceOpponentSpeed=THREE.MathUtils.damp(dragRaceOpponentSpeed,52,1.4,dt);
  dragRaceOpponent.position.z+=dragRaceOpponentSpeed*dt;
  if(player.position.z>=-220 && Math.abs(player.position.x)<10) {
    const won=player.position.z>=dragRaceOpponent.position.z;
    dragRaceHud.textContent=won?'YOU WIN · '+dragRaceTime.toFixed(2)+'s · +$250':'YOU LOSE · '+dragRaceTime.toFixed(2)+'s';
    awardCredits(won?250:50); dragRaceActive=false; dragRaceOpponent.visible=false;
    window.setTimeout(()=>{dragRaceHud.style.display='none';},3000);
  } else if(player.position.z < -560 || Math.abs(player.position.x)>20) {
    dragRaceHud.textContent='RACE LEFT · TRY AGAIN'; dragRaceActive=false; if(dragRaceOpponent)dragRaceOpponent.visible=false;
    window.setTimeout(()=>{dragRaceHud.style.display='none';},2500);
  } else dragRaceHud.textContent='DRAG RACE · '+dragRaceTime.toFixed(2)+'s';
}
function updateOpenCity(dt,stats) {
  if(cityOnFoot){updateCityOnFoot(dt);return;}
  if(!takedownHud) {
    takedownHud=document.createElement('div');
    takedownHud.id='takedown-charge-hud';
    Object.assign(takedownHud.style,{position:'fixed',left:'50%',bottom:'92px',transform:'translateX(-50%)',zIndex:'30',width:'min(260px,70vw)',padding:'9px 12px',borderRadius:'8px',background:'rgba(5,13,22,.82)',color:'#fff',font:'700 12px Arial,sans-serif',letterSpacing:'1px',textAlign:'center',pointerEvents:'none',boxSizing:'border-box'});
    document.body.appendChild(takedownHud);
  }
  nitroActive=keys.nitro&&nitro>0&&!keys.brake;
  nitro=THREE.MathUtils.clamp(nitro+(nitroActive?-34:8)*dt,0,100);
  const maxSpeed=(stats.maxSpeed+(nitroActive?45:0))/3.6;
  const forward=keys.accelerate||autoAccel;
  if(keys.brake) {
    if(citySpeedMps>1.2)citySpeedMps=Math.max(0,citySpeedMps-(stats.braking/3.6+citySpeedMps*0.8)*dt);
    else citySpeedMps=Math.max(-8,citySpeedMps-stats.acceleration/3.6*0.55*dt);
  } else if(forward) citySpeedMps=Math.min(maxSpeed,citySpeedMps+stats.acceleration/3.6*(nitroActive?1.55:1)*dt);
  else citySpeedMps=THREE.MathUtils.damp(citySpeedMps,0,0.38,dt);
  const steer=(keys.left?1:0)-(keys.right?1:0);
  const speedFactor=THREE.MathUtils.clamp(Math.abs(citySpeedMps)/9,0.18,1.35);
  cityHeading+=steer*1.35*speedFactor*Math.sign(citySpeedMps||1)*dt;
  cityHeading=THREE.MathUtils.euclideanModulo(cityHeading+Math.PI,Math.PI*2)-Math.PI;
  player.rotation.y=cityHeading;
  const direction=new THREE.Vector3(Math.sin(cityHeading),0,Math.cos(cityHeading));
  const oldPosition=player.position.clone();
  // Driving on grass is possible, but it adds a small rolling resistance.
  const roadDistanceX=Math.abs(player.position.x-Math.round(player.position.x/CITY_BLOCK)*CITY_BLOCK);
  const roadDistanceZ=Math.abs(player.position.z-Math.round(player.position.z/CITY_BLOCK)*CITY_BLOCK);
  const onRoad=Math.min(roadDistanceX,roadDistanceZ)<=11.5;
  const surfaceFactor=onRoad?1:0.84;
  if(!onRoad)citySpeedMps=THREE.MathUtils.damp(citySpeedMps,citySpeedMps*0.94,1.8,dt);
  player.position.addScaledVector(direction,citySpeedMps*surfaceFactor*dt);
  player.position.y=citySpawnPosition.y;
  // Keep the player inside the connected city limits.
  player.position.x=THREE.MathUtils.clamp(player.position.x,-CITY_HALF+14,CITY_HALF-14);
  player.position.z=THREE.MathUtils.clamp(player.position.z,-CITY_HALF+14,CITY_HALF-14);
  const lateral=new THREE.Vector3(Math.cos(cityHeading),0,-Math.sin(cityHeading));
  const lateralSpeed=steer*citySpeedMps*0.12*surfaceFactor;
  player.position.addScaledVector(lateral,lateralSpeed*dt);
  // Stop the car at building hitboxes and reduce speed on impact.
  if (cityCollisionCount && cityPositionBlocked(player.position.x, player.position.z)) {
    player.position.x = oldPosition.x;
    player.position.z = oldPosition.z;
    citySpeedMps *= -0.16;
  }
  player.userData.body.rotation.z=THREE.MathUtils.damp(player.userData.body.rotation.z||0,-steer*0.09,4,dt);
  for(const wheel of player.userData.wheels||[])wheel.rotation.x+=citySpeedMps*dt;
  actualSpeed=Math.abs(citySpeedMps)*3.6;
  if(actualSpeed>stats.maxSpeed*0.82)takedownCharge=Math.min(100,takedownCharge+dt*20);
  takedownHud.textContent='TAKEDOWN CHARGE  '+Math.floor(takedownCharge)+'%';
  cityDistance+=Math.abs(citySpeedMps)*dt;
  score=Math.floor(cityDistance);
  updateDragRace(dt);
  // Speeding is a fictional in-game offence that builds a wanted level.
  if(actualSpeed>125) cityLawbreakingTime+=dt;
  else cityLawbreakingTime=Math.max(0,cityLawbreakingTime-dt*1.4);
  if(cityLawbreakingTime>2.5) {
    cityWantedLevel=Math.min(5,Math.max(cityWantedLevel,1+Math.floor((actualSpeed-125)/35)));
    cityLawbreakingTime=0;
  }
  if(!cityCrimeHud) {
    cityCrimeHud=document.createElement('div');
    Object.assign(cityCrimeHud.style,{position:'fixed',top:'14px',left:'14px',zIndex:'42',padding:'8px 11px',borderRadius:'8px',background:'rgba(5,12,20,.82)',color:'#fff',font:'bold 13px Arial',pointerEvents:'none'});
    document.body.appendChild(cityCrimeHud);
  }
  cityCrimeHud.style.display=cityWantedLevel?'block':'none';
  cityCrimeHud.textContent='WANTED '+ '★'.repeat(cityWantedLevel);
  cityPoliceSpawnTimer-=dt;
  if(cityWantedLevel>0 && cityPolice.filter(p=>!p.disabled).length<Math.min(6,cityWantedLevel+1) && cityPoliceSpawnTimer<=0) {
    spawnCityPolice(); cityPoliceSpawnTimer=5.5;
  }
  // Active police cars pursue the player while wanted. The chase cools down after
  // the player stays below the offence threshold for a while.
  for(const cop of cityPolice) {
    if(cop.disabled)continue;
    const dx=player.position.x-cop.mesh.position.x,dz=player.position.z-cop.mesh.position.z;
    const distance=Math.hypot(dx,dz);
    const desired=Math.atan2(dx,dz);
    let delta=Math.atan2(Math.sin(desired-cop.mesh.rotation.y),Math.cos(desired-cop.mesh.rotation.y));
    cop.mesh.rotation.y+=THREE.MathUtils.clamp(delta,-1.8*dt,1.8*dt);
    const speed=cityWantedLevel?Math.min(43,29+cityWantedLevel*2):0;
    cop.mesh.position.x+=Math.sin(cop.mesh.rotation.y)*speed*dt;
    cop.mesh.position.z+=Math.cos(cop.mesh.rotation.y)*speed*dt;
    if(distance<3.7 && hitCooldown<=0) { damagePlayer(4+cityWantedLevel); citySpeedMps*=0.78; hitCooldown=0.9; }
  }
  if(cityWantedLevel>0 && cityLawbreakingTime===0 && actualSpeed<85) {
    cityPoliceSpawnTimer-=dt*0.35;
    if(cityPoliceSpawnTimer < -18) { cityWantedLevel=0; for(const cop of cityPolice){scene.remove(cop.mesh);cop.disabled=true;} }
  }
  // Repair kits spawn on the streets and restore the existing health system.
  cityRepairTimer-=dt;
  if(cityRepairTimer<=0&&cityRepairPickups.length<3) {
    spawnCityRepairPickup();
    cityRepairTimer=8+Math.random()*5;
  }
  for(let i=cityRepairPickups.length-1;i>=0;i--) {
    const kit=cityRepairPickups[i];
    kit.rotation.y+=dt*(kit.userData.rotationSpeed||1.4);
    if(kit.position.distanceTo(player.position)<3.3&&playerHealth<100) {
      playerHealth=Math.min(100,playerHealth+35);
      updateHealthDisplay();
      scene.remove(kit);cityRepairPickups.splice(i,1);
      const toast=$('near-miss');if(toast){toast.textContent='REPAIR KIT · +35% HEALTH';toast.classList.add('show');}
    }
  }
  // Traffic uses the same grid and makes deliberate turns at intersections.
  while(cityTraffic.length<12)spawnCityTraffic();
  for(const bot of cityTraffic) {
    bot.turnCooldown-=dt;
    const dir=bot.axis==='x'?new THREE.Vector3(bot.sign,0,0):new THREE.Vector3(0,0,bot.sign);
    bot.mesh.position.addScaledVector(dir,bot.speed*dt);
    const along=bot.axis==='x'?bot.mesh.position.x:bot.mesh.position.z;
    const junction=Math.round(along/CITY_BLOCK)*CITY_BLOCK;
    if(Math.abs(along-junction)<3.2&&bot.turnCooldown<=0&&Math.random()<0.08) {
      const lane=(Math.random()<0.5?-1:1)*3.8;
      if(bot.axis==='x') {
        bot.axis='z';
        bot.mesh.position.x=junction+lane;
        bot.sign=Math.random()<0.5?-1:1;
      } else {
        bot.axis='x';
        bot.mesh.position.z=junction+lane;
        bot.sign=Math.random()<0.5?-1:1;
      }
      bot.turnCooldown=3.5;
    }
    bot.mesh.rotation.y=bot.axis==='x'?(bot.sign>0?Math.PI/2:-Math.PI/2):(bot.sign>0?0:Math.PI);
    if(bot.mesh.position.x>CITY_HALF||bot.mesh.position.x< -CITY_HALF||bot.mesh.position.z>CITY_HALF||bot.mesh.position.z< -CITY_HALF) {
      bot.mesh.position.copy(player.position).add(new THREE.Vector3((Math.random()-0.5)*180,0,(Math.random()-0.5)*180));
    }
    if(cityVehicleCollision(player,bot.mesh,Math.abs(citySpeedMps))) {
      if(hitCooldown<=0){damagePlayer(3);hitCooldown=0.45;citySpeedMps*=0.68;cameraShake=Math.max(cameraShake,0.38);}
    }
  }
  // Free-roam mode: no automatic police chase.
  updateCityMinimap(dt);
  // Real building collision: test only buildings in the nearby 3x3 block
  // neighbourhood, then resolve the car against each building's footprint.
  const blockX=Math.floor(player.position.x/CITY_BLOCK);
  const blockZ=Math.floor(player.position.z/CITY_BLOCK);
  const carRadius=1.35;
  let buildingHit=false;
  for(let ox=-1;ox<=1;ox++)for(let oz=-1;oz<=1;oz++) {
    const nearby=cityBuildingGrid.get((blockX+ox)+','+(blockZ+oz));
    if(!nearby)continue;
    for(const building of nearby) {
      const dx=player.position.x-building.x;
      const dz=player.position.z-building.z;
      const px=building.halfW+carRadius-Math.abs(dx);
      const pz=building.halfD+carRadius-Math.abs(dz);
      if(px<=0||pz<=0)continue;
      buildingHit=true;
      if(px<pz)player.position.x=building.x+Math.sign(dx||oldPosition.x-building.x)* (building.halfW+carRadius);
      else player.position.z=building.z+Math.sign(dz||oldPosition.z-building.z)* (building.halfD+carRadius);
    }
  }
  if(buildingHit) {
    const impactSpeed=Math.abs(citySpeedMps);
    citySpeedMps*=impactSpeed>18? -0.18:0.22;
    cityHeading+=((player.position.x-oldPosition.x)-(player.position.z-oldPosition.z))*0.025;
    cameraShake=Math.max(cameraShake,Math.min(0.9,0.25+impactSpeed*0.025));
    if(hitCooldown<=0)damagePlayer(impactSpeed>18?8:3);
  }
  if(hitCooldown>0)hitCooldown-=dt;
  const fast=THREE.MathUtils.clamp(actualSpeed/Math.max(1,stats.maxSpeed),0,1);
  camera.fov=THREE.MathUtils.damp(camera.fov,68+fast*7+(nitroActive?2:0),2,dt);
  camera.updateProjectionMatrix();
  // Keep the city camera upright and behind the car regardless of a saved
  // highway/overhead camera preset.
  const cityCameraPosition = player.localToWorld(new THREE.Vector3(0, 5.2, -10));
  const cityCameraTarget = player.localToWorld(new THREE.Vector3(0, 1.1, 16));
  camera.position.lerp(cityCameraPosition, 1 - Math.exp(-7 * dt));
  camera.up.set(0, 1, 0);
  camera.lookAt(cityCameraTarget);
  cameraShake=THREE.MathUtils.damp(cameraShake,0,7,dt);
  if(cameraShake>0.01){camera.position.x+=Math.sin(performance.now()*0.03)*cameraShake*0.12;}
  updateProgression();
  $('score').textContent=Math.floor(score).toLocaleString();
  $('speed').textContent=Math.round(actualSpeed).toString();
  $('nitro-fill').style.width=nitro+'%';
  $('nitro-label').textContent=nitroActive?'BOOST':nitro>99?'READY':'CHARGING';
  $('speed-lines').style.opacity=String(fast*0.35);
  updateAudio();
}

function update(dt) {
for (let index = particles.length - 1; index >= 0; index--) {
const p = particles[index];
p.life -= dt;
p.velocity.y -= 12 * dt;
p.mesh.position.addScaledVector(p.velocity, dt);
if (p.smoke) {
  const fade = THREE.MathUtils.clamp(p.life / (p.maxLife || 1.85), 0, 1);
  p.mesh.material.opacity = 0.48 * fade;
  const scale = (p.startScale || 0.3) * (1 + (1 - fade) * 1.8);
  p.mesh.scale.setScalar(scale / Math.max(0.001, p.startScale || 0.3));
}
if (p.life <= 0) {
scene.remove(p.mesh);
p.mesh.geometry.dispose();
p.mesh.material.dispose();
particles.splice(index, 1);
}
}
if (!running || paused) return;
updateWeather(dt);
const spec = cars.find((car) => car.id === selectedCar) || cars.at(0);
const stats = effectiveCarStats(spec);
if (gameMode === 'escape' && cityWorldReady) {
  updateOpenCity(dt, stats);
  return;
}
const previousPlayer = { x: player.position.x, z: 7 };
nitroActive = keys.nitro && nitro > 0 && !keys.brake;
if (nitroActive) nitro = Math.max(0, nitro - dt * 34);
else nitro = Math.min(100, nitro + dt * 8);
const throttle = autoAccel || keys.accelerate;
const maxSpeed = stats.maxSpeed + (nitroActive ? 45 : 0);
if (actualSpeed >= maxSpeed * 0.82) takedownCharge = Math.min(100, takedownCharge + dt * 20);
if (!takedownHud) {
  takedownHud = document.createElement('div');
  takedownHud.id = 'takedown-charge-hud';
  Object.assign(takedownHud.style, {
    position: 'fixed', left: '50%', bottom: '92px', transform: 'translateX(-50%)',
    zIndex: '30', width: 'min(260px, 70vw)', padding: '9px 12px',
    borderRadius: '8px', background: 'rgba(5, 13, 22, 0.82)',
    color: '#fff', font: '700 12px Arial, sans-serif', letterSpacing: '1px',
    textAlign: 'center', pointerEvents: 'none', boxSizing: 'border-box'
  });
  document.body.appendChild(takedownHud);
}
takedownHud.textContent = 'TAKEDOWN CHARGE  ' + Math.floor(takedownCharge) + '%';
if (keys.brake) actualSpeed = Math.max(0, actualSpeed - (stats.braking + actualSpeed * 0.12) * dt);
else if (throttle) actualSpeed = Math.min(maxSpeed, actualSpeed + stats.acceleration * (nitroActive ? 1.55 : 1) * dt);
else actualSpeed = Math.max(0, actualSpeed - (2 + actualSpeed * 0.018) * dt);
if (Math.abs(playerLateral) > 9 && Math.abs(playerLateral) < 14) actualSpeed = Math.max(0, actualSpeed - 20 * dt);
if (nitroActive && Math.random() < dt * 12) {
addSparks(player.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.3, -2.4)), 1);
}
updateWorld(dt);
updatePlayer(dt);
updateTraffic(dt, previousPlayer);
updateRepairPickups(dt);
// Advance distance before the chase so police speed and backup waves use
// the current frame's distance, not a one-frame-old score.
score += actualSpeed / 3.6 * dt;
updatePoliceChase(dt);
updateProgression();
$('score').textContent = Math.floor(score).toLocaleString();
$('speed').textContent = Math.round(actualSpeed).toString();
$('nitro-fill').style.width = nitro + '%';
$('nitro-label').textContent = nitroActive ? 'BOOST' : nitro > 99 ? 'READY' : 'CHARGING';
const fast = THREE.MathUtils.clamp(actualSpeed / Math.max(1, spec.maxSpeed), 0, 1);
updateCamera(dt, fast);
$('speed-lines').style.opacity = String(fast * 0.55);
updateAudio();
}
function updateCamera(dt, fast) {
  // Highway vehicles face local -Z; use the same presets with the correct
  // forward direction instead of mixing the old camera and preset positions.
  applyCameraMode(camera, player, dt, -1);
  // Apply the smooth, decaying shake after the preset so it remains visible.
  cameraShake = THREE.MathUtils.damp(cameraShake, 0, 7.5, dt);
  if (cameraShake > 0.001 && dt > 0) {
    const t = performance.now() * 0.001;
    camera.position.x += Math.sin(t * 28) * cameraShake * 0.16;
    camera.position.y += Math.sin(t * 37) * cameraShake * 0.055;
  }
}
function resize() {
const width = canvas.clientWidth || innerWidth;
const height = canvas.clientHeight || innerHeight;
renderer.setSize(width, height, false);
camera.aspect = width / height;
camera.updateProjectionMatrix();
}
function animate() {
requestAnimationFrame(animate);
update(Math.min(clock.getDelta(), 0.04));
renderer.render(scene, camera);
}
function setControl(name, value) { keys[name] = value; }
function togglePause() {
if (!running) return;
paused = !paused;
if (paused) {
  Object.keys(keys).forEach((key) => { keys[key] = false; });
  showPage('pause-page');
} else showPage('');
}
window.addEventListener('keydown', (event) => {
const key = event.key.toLowerCase();
if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(key)) event.preventDefault();
if (key === 'escape' && running) { togglePause(); return; }
if (key === 'arrowleft' || key === 'a') setControl('left', true);
if (key === 'arrowright' || key === 'd') setControl('right', true);
if (key === 'arrowup' || key === 'w') setControl('accelerate', true);
if (key === 'arrowdown' || key === 's') setControl('brake', true);
if (key === ' ') setControl('drift', true);
if (key === 'shift') setControl('nitro', true);
if (key === 'f' && running && cityWorldReady) { if(cityOnFoot){if(cityParkedCar&&cityAvatar&&cityAvatar.position.distanceTo(cityParkedCar.position)<7)enterCityVehicle(cityParkedCar);else if(cityCrimeHud)cityCrimeHud.textContent='WALK BACK TO YOUR PARKED CAR';}else exitCityVehicle(); }
if (key === 'e' && running && cityWorldReady) { if(cityOnFoot){if(!tryEnterNearbyCityCar()&&cityCrimeHud)cityCrimeHud.textContent='GET CLOSER TO A TRAFFIC CAR';}else if(!attemptCityRobbery()) startDragRace(); }
}, { passive: false });
window.addEventListener('keyup', (event) => {
const key = event.key.toLowerCase();
if (key === 'arrowleft' || key === 'a') setControl('left', false);
if (key === 'arrowright' || key === 'd') setControl('right', false);
if (key === 'arrowup' || key === 'w') setControl('accelerate', false);
if (key === 'arrowdown' || key === 's') setControl('brake', false);
if (key === ' ') setControl('drift', false);
if (key === 'shift') setControl('nitro', false);
});
window.addEventListener('blur', () => Object.keys(keys).forEach((key) => { keys[key] = false; }));
document.querySelectorAll('[data-control]').forEach((button) => {
const key = button.dataset.control;
const release = (event) => {
event.preventDefault();
setControl(key, false);
button.classList.remove('active');
};
button.addEventListener('pointerdown', (event) => {
event.preventDefault();
button.setPointerCapture?.(event.pointerId);
setControl(key, true);
button.classList.add('active');
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
button.addEventListener(type, release);
}
});
function createCityAvatar() {
  const avatar=new THREE.Group();
  const shirt=new THREE.MeshStandardMaterial({color:0x2877b9,roughness:0.9});
  const pants=new THREE.MeshStandardMaterial({color:0x252b35,roughness:1});
  const skin=new THREE.MeshStandardMaterial({color:0xc58d68,roughness:0.9});
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(0.34,0.62,4,8),shirt);
  torso.position.y=1.18;avatar.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.23,12,10),skin);
  head.position.y=1.83;avatar.add(head);
  const legs=new THREE.Mesh(new THREE.BoxGeometry(0.48,0.72,0.28),pants);
  legs.position.y=0.48;avatar.add(legs);
  avatar.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  scene.add(avatar);return avatar;
}
function exitCityVehicle() {
  if(cityOnFoot||!player)return;
  cityOnFoot=true;cityFootHeading=cityHeading;citySpeedMps=0;actualSpeed=0;
  cityParkedCar=createCar(cars.find(c=>c.id===selectedCar)?.color||0x2877b9,true,cars.find(c=>c.id===selectedCar)?.modelStyle||0);
  cityParkedCar.position.copy(player.position);cityParkedCar.rotation.copy(player.rotation);scene.add(cityParkedCar);
  player.visible=false;
  cityAvatar=createCityAvatar();cityAvatar.position.copy(player.position);cityAvatar.rotation.y=cityFootHeading;
  if(cityCrimeHud){cityCrimeHud.style.display='block';cityCrimeHud.textContent='ON FOOT · WASD TO WALK · E TO ENTER';}
}
function enterCityVehicle(target) {
  if(!cityOnFoot||!target)return false;
  if(cityAvatar){scene.remove(cityAvatar);cityAvatar=null;}
  if(target===cityParkedCar)cityParkedCar=null;
  if(player)player.visible=false;
  player=target;player.visible=true;player.position.y=0;
  cityHeading=player.rotation.y;citySpeedMps=0;cityOnFoot=false;
  player.userData.body=player.userData.body||null;
  return true;
}
function tryEnterNearbyCityCar() {
  if(!cityOnFoot||!cityAvatar)return false;
  let nearest=null,nearestDistance=7;
  for(const bot of cityTraffic) {
    const d=cityAvatar.position.distanceTo(bot.mesh.position);
    if(d<nearestDistance){nearest=bot;nearestDistance=d;}
  }
  if(!nearest)return false;
  const mesh=nearest.mesh;
  cityTraffic=cityTraffic.filter(bot=>bot!==nearest);
  return enterCityVehicle(mesh);
}
function updateCityOnFoot(dt) {
  if(!cityAvatar)return;
  const turn=(keys.left?1:0)-(keys.right?1:0);
  cityFootHeading+=turn*2.2*dt;
  const forward=(keys.accelerate?1:0)-(keys.brake?1:0);
  const direction=new THREE.Vector3(Math.sin(cityFootHeading),0,Math.cos(cityFootHeading));
  cityAvatar.position.addScaledVector(direction,forward*7*dt);
  cityAvatar.position.x=THREE.MathUtils.clamp(cityAvatar.position.x,-CITY_HALF+5,CITY_HALF-5);
  cityAvatar.position.z=THREE.MathUtils.clamp(cityAvatar.position.z,-CITY_HALF+5,CITY_HALF-5);
  cityAvatar.rotation.y=cityFootHeading;
  player.position.copy(cityAvatar.position);
  for(const bot of cityTraffic) {
    const dir=bot.axis==='x'?new THREE.Vector3(bot.sign,0,0):new THREE.Vector3(0,0,bot.sign);
    bot.mesh.position.addScaledVector(dir,bot.speed*dt);
    bot.mesh.rotation.y=bot.axis==='x'?(bot.sign>0?Math.PI/2:-Math.PI/2):(bot.sign>0?0:Math.PI);
  }
  for(const cop of cityPolice) if(!cop.disabled) {
    const dx=cityAvatar.position.x-cop.mesh.position.x,dz=cityAvatar.position.z-cop.mesh.position.z;
    const angle=Math.atan2(dx,dz),delta=Math.atan2(Math.sin(angle-cop.mesh.rotation.y),Math.cos(angle-cop.mesh.rotation.y));
    cop.mesh.rotation.y+=THREE.MathUtils.clamp(delta,-1.8*dt,1.8*dt);
    cop.mesh.position.x+=Math.sin(cop.mesh.rotation.y)*Math.min(43,29+cityWantedLevel*2)*dt;
    cop.mesh.position.z+=Math.cos(cop.mesh.rotation.y)*Math.min(43,29+cityWantedLevel*2)*dt;
  }
  camera.position.set(cityAvatar.position.x-Math.sin(cityFootHeading)*5,cityAvatar.position.y+3.4,cityAvatar.position.z-Math.cos(cityFootHeading)*5);
  camera.lookAt(cityAvatar.position.x,cityAvatar.position.y+1.2,cityAvatar.position.z);
  updateCityMinimap(dt);
  if(cityCrimeHud){cityCrimeHud.style.display='block';cityCrimeHud.textContent='ON FOOT · E: STEAL CAR · F: ENTER/EXIT';}
  actualSpeed=0;
}
// Hide the old mode picker: the game now has only the police-escape mode.
const modePicker = $('mode-escape')?.parentElement;
if (modePicker) modePicker.style.display = 'none';
gameMode = 'escape';
save('tr-game-mode', 'escape');
setPlayerPoliceLights(false);
$('menu-play').addEventListener('click', startGame);
$('garage-play').addEventListener('click', startGame);
$('retry-button').addEventListener('click', startGame);
$('menu-garage').addEventListener('click', showGarage);
$('menu-settings').addEventListener('click', showSettings);
$('pause-button').addEventListener('click', togglePause);
$('resume-button').addEventListener('click', togglePause);
document.querySelectorAll('.back-menu').forEach((button) => button.addEventListener('click', showMenu));
$('auto-toggle').addEventListener('click', () => {
autoAccel = !autoAccel;
save('tr-auto', autoAccel);
syncSettings();
});
$('road-mode-toggle').disabled = true;
$('road-mode-toggle').setAttribute('aria-label', 'One-way traffic only');
$('night-toggle').addEventListener('click', () => setNight(!night));
$('location-toggle').addEventListener('click', () => setLocation(locationIndex+1));
$('weather-toggle').addEventListener('click', () => {
  const modes=['clear','rain','fog','snow'];
  setWeather(modes[(modes.indexOf(weatherMode)+1)%modes.length]);
});
$('sound-toggle').addEventListener('click', () => {
soundEnabled = !soundEnabled;
save('tr-sound', soundEnabled);
syncSettings();
if (soundEnabled) initAudio();
else if (audioContext) engineGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.05);
});
syncSettings();
createEnvironment();
createPlayer();
setNight(night);
setLocation(locationIndex);
setWeather(weatherMode);
renderGarage();
refreshWallet();
resize();
// Always preload the Lexus before showing the menu, even if another owned
// car was selected during a previous session. Traffic loads independently.
loadStarterModel()
  .then(() => {
    starterLoadFinished = true;
    finishLoadingScreen();
  })
  .catch((error) => {
    console.error('Could not preload the Lexus model:', error);
    $('loading-message').textContent = 'Lexus model unavailable — using backup car.';
    starterLoadFinished = true;
    finishLoadingScreen();
  });
window.setTimeout(loadTrafficModels, 0);
window.setTimeout(loadRoadsideModels, 0);
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
animate();
