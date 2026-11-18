import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const scene = new THREE.Scene();
const dayColor = new THREE.Color(0x9bbdd0);
const nightColor = new THREE.Color(0x071321);
scene.background = dayColor;
scene.fog = new THREE.Fog(dayColor, 55, 250);
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 650);
camera.position.set(0, 5.5, 15);
camera.lookAt(0, 1, -22);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch {
  document.body.innerHTML = '<p style="padding:2rem;color:white;font:16px sans-serif">This game needs a current browser with WebGL enabled.</p>';
  throw new Error('WebGL is unavailable');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
const particles = [];
const lanes = [-6.75, -2.25, 2.25, 6.75];
const keys = { left: false, right: false, accelerate: false, brake: false, drift: false, nitro: false };
const cars = [
  { id: 'starter', name: 'LEXUS LS 500H', color: 0x1678c8, cost: 0, maxSpeed: 175, acceleration: 25, handling: 8.3 },
  { id: 'rally', name: 'RALLY GT', color: 0xd54b3e, cost: 250, maxSpeed: 205, acceleration: 34, handling: 9.2 },
  { id: 'midnight', name: 'MIDNIGHT', color: 0x403f70, cost: 650, maxSpeed: 225, acceleration: 27, handling: 7.8 },
  { id: 'sunset', name: 'SUNSET', color: 0xe9a33b, cost: 1100, maxSpeed: 195, acceleration: 39, handling: 10.2 },
  { id: 'emerald', name: 'EMERALD', color: 0x328260, cost: 1700, maxSpeed: 240, acceleration: 31, handling: 8.5 },
  { id: 'silver', name: 'SILVERLINE', color: 0xb8c3c6, cost: 2600, maxSpeed: 260, acceleration: 36, handling: 9.0 },
];

function load(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* Storage may be disabled. */ }
}

let credits = Math.max(0, Number(load('tr-credits', '0')) || 0);
let owned;
try { owned = new Set(JSON.parse(load('tr-owned', '["starter"]'))); } catch { owned = new Set(['starter']); }
owned.add('starter');
let selectedCar = load('tr-car', 'starter');
if (!owned.has(selectedCar) || !cars.some((car) => car.id === selectedCar)) selectedCar = 'starter';
let roadMode = load('tr-mode', 'one-way');
if (!['one-way', 'two-way'].includes(roadMode)) roadMode = 'one-way';
let autoAccel = load('tr-auto', 'true') !== 'false';
let soundEnabled = load('tr-sound', 'true') !== 'false';
let night = load('tr-night', 'false') === 'true';

let player;
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
let sessionCredits = 0;

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

function createRoad(z) {
  const group = new THREE.Group();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(18, 0.22, 50), roadMat);
  slab.position.y = -0.02;
  slab.receiveShadow = true;
  group.add(slab);
  for (const x of [-9, 9]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.04, 50), whiteLine);
    edge.position.set(x, 0.105, 0);
    group.add(edge);
  }
  for (const x of [-4.5, 0, 4.5]) {
    if (roadMode === 'two-way' && x === 0) {
      for (const offset of [-0.12, 0.12]) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 50), yellowLine);
        line.position.set(offset, 0.11, 0);
        group.add(line);
      }
    } else {
      for (let dz = -22; dz < 25; dz += 10) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 4.8), whiteLine);
        dash.position.set(x, 0.11, dz);
        group.add(dash);
      }
    }
  }
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 50), material(0x8c9290, 0.9));
    shoulder.position.set(side * 10.5, -0.06, 0);
    group.add(shoulder);
  }
  group.position.z = z;
  scene.add(group);
  roads.push(group);
}

function createCar(color, isPlayer = false, style = 0) {
  const group = new THREE.Group();
  const paint = material(color, 0.28, 0.42, { clearcoat: 0.65, clearcoatRoughness: 0.2 });
  const glass = material(0x162a35, 0.2, 0.25, { metalness: 0.2, roughness: 0.18 });
  const rubber = material(0x111417, 0.92);
  const rim = material(0x9ba9ad, 0.28, 0.75);
  const width = style ? 2.08 : 1.88;
  const length = style ? 4.8 : 4.25;
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(width * 0.44, length * 0.72, 4, 12), paint);
  lower.rotation.x = Math.PI / 2;
  lower.scale.set(1, 1, 0.37);
  lower.position.y = 0.64;
  lower.castShadow = true;
  group.add(lower);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), paint);
  hood.scale.set(width * 0.48, 0.18, 0.73);
  hood.position.set(0, 0.92, 1.36);
  group.add(hood);
  const cabin = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), glass);
  cabin.scale.set(width * 0.37, 0.43, 0.98);
  cabin.position.set(0, 1.13, -0.22);
  cabin.castShadow = true;
  group.add(cabin);
  const roof = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), paint);
  roof.scale.set(width * 0.31, 0.19, 0.62);
  roof.position.set(0, 1.48, -0.28);
  group.add(roof);
  const wheelMeshes = [];
  for (const side of [-1, 1]) {
    for (const z of [1.22, -1.32]) {
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
  group.userData.collisionHalfWidth = width * 0.52;
  group.userData.collisionHalfLength = length * 0.47;
  return group;
}

function createPlayer() {
  const spec = cars.find((car) => car.id === selectedCar) || cars.at(0);
  player = createCar(spec.color, true);
  player.position.set(lanes.at(2), 0, 7);
  scene.add(player);
  player.userData.syntheticChildren = [...player.children];
  applyPlayerCar(selectedCar);
  const lamp = new THREE.SpotLight(0xe5f5ff, 0, 55, Math.PI / 7, 0.55, 1.5);
  lamp.position.set(0, 1.5, 2.1);
  lamp.target.position.set(0, 0, -32);
  player.add(lamp, lamp.target);
  player.userData.headlamp = lamp;
}

const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://gstatic.com');
gltfLoader.setDRACOLoader(dracoLoader);

let starterModelPromise;

function loadStarterModel() {
  if (!starterModelPromise) {
    starterModelPromise = new Promise((resolve, reject) => {
gltfLoader.load('./2023_lexus_ls_500h.glb', (gltf) => resolve(gltf.scene), undefined, reject);
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
if (!front && (name.includes('ext_headlamp') || name.includes('headlight'))) front = object;
if (!rear && (name.includes('ext_taillamp') || name.includes('taillamp') || name.includes('rear_red_glass'))) rear = object;
});
if (front && rear) {
const frontBox = new THREE.Box3().setFromObject(front);
const rearBox = new THREE.Box3().setFromObject(rear);
const frontCenter = frontBox.getCenter(new THREE.Vector3());
const rearCenter = rearBox.getCenter(new THREE.Vector3());
const frontDirection = frontCenter.sub(rearCenter);
if (frontDirection.lengthSq() > 0.001) {
const currentAngle = Math.atan2(frontDirection.x, frontDirection.z);
model.rotation.y += Math.PI - currentAngle;
}
}
model.updateWorldMatrix(true, true);
const box = new THREE.Box3().setFromObject(model);
const size = box.getSize(new THREE.Vector3());
const length = Math.max(size.x, size.z);
if (length > 0) model.scale.setScalar(4.25 / length);
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
function applyPlayerCar(carId) {
if (!player) return;
if (player.userData.starterModel) {
player.remove(player.userData.starterModel);
player.userData.starterModel = null;
}
for (const child of player.userData.syntheticChildren || []) child.visible = true;
if (carId === 'starter') {
loadStarterModel()
.then((source) => {
if (selectedCar !== 'starter') return;
const model = prepareStarterModel(source);
player.userData.starterModel = model;
player.add(model);
for (const child of player.userData.syntheticChildren || []) child.visible = false;
})
.catch((err) => {
console.error('Could not load 2023_lexus_ls_500h.glb:', err);
});
}
}
function createEnvironment() {
for (let i = 0; i < 8; i++) createRoad(-i * 50);
for (let i = 0; i < 3; i++) {
const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 600), grassMat);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.2, -250 - i * 600);
ground.receiveShadow = true;
scene.add(ground);
grounds.push(ground);
}
for (let z = -220; z < 40; z += 22) {
for (const side of [-1, 1]) {
const group = new THREE.Group();
if (Math.random() < 0.72) {
const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.6, 9), material(0x604732, 1));
trunk.position.y = 0.8;
group.add(trunk);
const crown = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), material(Math.random() < 0.5 ? 0x3c7049 : 0x557c50, 0.95));
crown.scale.set(1.2, 1.4, 1.1);
crown.position.y = 2.1;
group.add(crown);
} else {
const height = 4 + Math.random() * 7;
const building = new THREE.Mesh(new THREE.BoxGeometry(3, height, 4), material(0x59666c, 0.9));
building.position.y = height / 2;
group.add(building);
}
group.position.set(side * (14 + Math.random() * 2), 0, z + Math.random() * 7);
scene.add(group);
scenery.push(group);
}
}
for (const side of [-1, 1]) {
const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 470), material(0x778389, 0.6, 0.4));
rail.position.set(side * 11.6, 0.65, -105);
scene.add(rail);
for (let z = -220; z < 30; z += 18) {
const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 8), material(0x9ba6a2, 0.6, 0.3));
post.position.set(side * 11.55, 0.45, z);
scene.add(post);
scenery.push(post);
}
}
}
function chooseTrafficLane() {
if (roadMode === 'one-way') return lanes[Math.floor(Math.random() * lanes.length)];
return Math.random() < 0.38 ? lanes[Math.floor(Math.random() * 2)] : lanes[2 + Math.floor(Math.random() * 2)];
}
function spawnTraffic() {
if (traffic.length >= 16) return;
const lane = chooseTrafficLane();
const z = -105 - Math.random() * 30;
if (traffic.some((item) => item.lane === lane && Math.abs(item.mesh.position.z - z) < 24)) return;
const oncoming = roadMode === 'two-way' && lane < 0;
const botSpeed = 60 + Math.random() * 100;
const colors = [0xe8e5dc, 0xb84238, 0x334f66, 0x8b9b92, 0xc59b4e, 0x252a32];
const car = createCar(colors[Math.floor(Math.random() * colors.length)], false, Math.random() < 0.25 ? 1 : 0);
car.position.set(lane, 0, z);
if (oncoming) car.rotation.y = Math.PI;
if (night) {
const light = new THREE.PointLight(0xffe4b7, 0.45, 12, 2);
light.position.set(0, 0.8, oncoming ? -2.8 : 2.8);
car.add(light);
}
scene.add(car);
traffic.push({ mesh: car, lane, oncoming, botSpeed, checkedMiss: false, previousZ: z });
}
function clearTraffic() {
for (const item of traffic) scene.remove(item.mesh);
traffic.length = 0;
}
function refreshWallet() {
for (const id of ['wallet', 'menu-wallet', 'garage-wallet']) {
$(id).textContent = credits.toLocaleString();
}
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
'' +
'' + car.name + '' +
'' + state + '' +
'' + car.maxSpeed + ' top · ' + car.acceleration + ' accel';
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
player.userData.paint.color.setHex(car.color);
applyPlayerCar(selectedCar);
refreshWallet();
renderGarage();
});
list.append(button);
}
if (!list.querySelector('.sketchfab-link')) {
const link = document.createElement('a');
link.className = 'secondary-button sketchfab-link';
link.href = 'sketchfab.com';
link.target = '_blank';
link.rel = 'noopener noreferrer';
link.textContent = 'Browse downloadable Sketchfab cars ↗';
list.append(link);
}
refreshWallet();
}
function showPage(id) {
document.querySelectorAll('.overlay').forEach((page) => page.classList.add('hidden'));
if (id) $(id).classList.remove('hidden');
}
function showMenu() { running = false; paused = false; showPage('main-menu'); }
function showGarage() { if (running) { running = false; paused = false; } renderGarage(); showPage('garage-page'); }
function showSettings() { if (running) { running = false; paused = false; } syncSettings(); showPage('settings-page'); }
function syncSettings() {
const set = (id, label, active) => {
const button = $(id);
button.textContent = label;
button.classList.toggle('active', active);
button.setAttribute('aria-pressed', String(active));
};
set('auto-toggle', autoAccel ? 'ON' : 'OFF', autoAccel);
set('road-mode-toggle', roadMode === 'one-way' ? 'ONE WAY' : 'TWO WAY', roadMode === 'two-way');
set('night-toggle', night ? 'NIGHT' : 'DAY', night);
set('sound-toggle', soundEnabled ? 'ON' : 'OFF', soundEnabled);
$('road-mode-note').textContent = roadMode === 'one-way'
? 'All four lanes travel in your direction.'
: 'Two lanes each way with a double-yellow divider.';
}
function startGame() {
for (const key of Object.keys(keys)) keys[key] = false;
score = 0;
actualSpeed = 0;
steerVelocity = 0;
nitro = 100;
nitroActive = false;
spawnTimer = 0.75;
burstTimer = 0;
burstCooldown = 8 + Math.random() * 7;
cameraShake = 0;
nearMissChain = 0;
sessionCredits = 0;
player.position.set(lanes.at(2), 0, 7);
player.rotation.set(0, 0, 0);
clearTraffic();
for (const particle of particles) scene.remove(particle.mesh);
particles.length = 0;
$('score').textContent = '0';
$('speed').textContent = '0';
$('nitro-fill').style.width = '100%';
$('speed-lines').style.opacity = '0';
running = true;
paused = false;
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
sessionCredits += reward;
save('tr-credits', credits);
refreshWallet();
}
function showNearMiss() {
nearMissChain = Math.min(nearMissChain + 1, 4);
const reward = 5 + (nearMissChain - 1) * 2;
awardCredits(reward);
const toast = $('near-miss');
toast.innerHTML = 'NEAR MISS! +' + reward + '';
toast.classList.add('show');
window.clearTimeout(showNearMiss.timeout);
showNearMiss.timeout = window.setTimeout(() => toast.classList.remove('show'), 950);
}
function finishGame() {
if (!running) return;
running = false;
nitroActive = false;
cameraShake = 0.8;
addSparks(player.position.clone().add(new THREE.Vector3(0, 0.7, 0)), 34);
playTone(90, 0.5, 'sawtooth', 0.13);
awardCredits(Math.floor(score / 120));
$('earned-credits').textContent = '+' + sessionCredits + ' credits earned';
$('final-score').innerHTML = Math.floor(score).toLocaleString() + ' METERS';
const flash = $('crash-flash');
flash.style.transition = 'none';
flash.style.opacity = '0.7';
requestAnimationFrame(() => {
flash.style.transition = 'opacity .55s';
flash.style.opacity = '0';
});
window.setTimeout(() => { if (!running) showPage('game-over'); }, 350);
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
const color = night ? nightColor : dayColor;
scene.background.copy(color);
scene.fog.color.copy(color);
hemi.intensity = night ? 0.45 : 1.45;
sun.intensity = night ? 0.18 : 2.2;
sun.color.set(night ? 0x9ab8ff : 0xffe6c6);
if (player?.userData.headlamp) player.userData.headlamp.intensity = night ? 2.8 : 0;
save('tr-night', night);
syncSettings();
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
road.position.z += move;
if (road.position.z >= 50) road.position.z -= roads.length * 50;
}
for (const prop of scenery) {
prop.position.z += move;
if (prop.position.z > 28) prop.position.z -= 270;
}
for (const ground of grounds) {
ground.position.z += move;
if (ground.position.z > 350) ground.position.z -= grounds.length * 600;
}
asphalt.offset.y = (asphalt.offset.y - move * 0.018) % 1;
}
function updatePlayer(dt) {
const spec = cars.find((car) => car.id === selectedCar) || cars.at(0);
const steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
const drifting = keys.drift && steer !== 0;
steerVelocity = THREE.MathUtils.damp(steerVelocity, steer * spec.handling * (drifting ? 1.16 : 1), drifting ? 4 : 8, dt);
player.position.x = THREE.MathUtils.clamp(player.position.x + steerVelocity * dt, -8, 8);
player.rotation.z = THREE.MathUtils.damp(player.rotation.z, -steerVelocity * 0.022 * (drifting ? 0.7 : 1), 7, dt);
player.rotation.y = THREE.MathUtils.damp(player.rotation.y, -steer * (drifting ? 0.1 : 0.04), 7, dt);
player.userData.body.position.y = 0.64 + Math.sin(performance.now() * 0.008) * Math.min(0.025, actualSpeed / 12000);
for (const wheel of player.userData.wheels) wheel.rotation.x += actualSpeed / 3.6 * dt * 0.85;
}
function updateTraffic(dt, previousPlayer) {
if (burstTimer > 0) burstTimer -= dt;
else if ((burstCooldown -= dt) <= 0) {
burstTimer = 4 + Math.random() * 3;
burstCooldown = 13 + Math.random() * 14;
spawnTimer = 0;
}
spawnTimer -= dt;
if (spawnTimer <= 0) {
const dense = burstTimer > 0;
const count = dense && Math.random() < 0.3 ? 2 : 1;
for (let i = 0; i < count; i++) spawnTraffic();
spawnTimer = dense ? 0.22 + Math.random() * 0.2 : 0.7 + Math.random() * 0.55;
}
const oldPositions = new Map(traffic.map((item) => [item, item.mesh.position.z]));
const playerMps = actualSpeed / 3.6 * 2;
for (const item of traffic) {
const botMps = item.botSpeed / 3.6 * 2;
item.mesh.position.z += (item.oncoming ? playerMps + botMps : playerMps - botMps) * dt;
for (const wheel of item.mesh.userData.wheels) wheel.rotation.x += item.botSpeed / 3.6 * dt;
}
const laneGroups = new Map();
for (const item of traffic) {
if (!laneGroups.has(item.lane)) laneGroups.set(item.lane, []);
laneGroups.get(item.lane).push(item);
}
for (const group of laneGroups.values()) {
group.sort((a, b) => oldPositions.get(a) - oldPositions.get(b));
for (let index = 1; index < group.length; index++) {
const leader = group[index - 1];
const follower = group[index];
const safeGap = (leader.mesh.userData.collisionHalfLength || 2.2) + (follower.mesh.userData.collisionHalfLength || 2.2) + 2.5;
follower.mesh.position.z = Math.max(follower.mesh.position.z, leader.mesh.position.z + safeGap);
}
}
for (let index = traffic.length - 1; index >= 0; index--) {
const item = traffic[index];
const newZ = item.mesh.position.z;
const prevRelZ = oldPositions.get(item) - previousPlayer.z;
const nextRelZ = newZ - player.position.z;
const relDeltaZ = nextRelZ - prevRelZ;
const t = relDeltaZ === 0 ? 0 : THREE.MathUtils.clamp(-prevRelZ / relDeltaZ, 0, 1);
const closestZ = prevRelZ + relDeltaZ * t;
const closestPlayerX = THREE.MathUtils.lerp(previousPlayer.x, player.position.x, t);
const dx = Math.abs(closestPlayerX - item.mesh.position.x);
if (
Math.abs(closestZ) < (player.userData.collisionHalfLength || 2.1) + (item.mesh.userData.collisionHalfLength || 2.1) &&
dx < (player.userData.collisionHalfWidth || 1.05) + (item.mesh.userData.collisionHalfWidth || 1.05)
) {
finishGame();
return;
}
if (!item.checkedMiss && prevRelZ < 0 && nextRelZ >= 0) {
item.checkedMiss = true;
if (dx > 1.9 && dx < 3.3) showNearMiss();
else if (dx >= 3.3) nearMissChain = 0;
}
if (newZ > 24 || newZ < -190) {
scene.remove(item.mesh);
traffic.splice(index, 1);
}
}
}
function update(dt) {
for (let index = particles.length - 1; index >= 0; index--) {
const p = particles[index];
p.life -= dt;
p.velocity.y -= 12 * dt;
p.mesh.position.addScaledVector(p.velocity, dt);
if (p.life <= 0) {
scene.remove(p.mesh);
p.mesh.geometry.dispose();
p.mesh.material.dispose();
particles.splice(index, 1);
}
}
if (!running || paused) return;
const spec = cars.find((car) => car.id === selectedCar) || cars.at(0);
const previousPlayer = { x: player.position.x, z: player.position.z };
nitroActive = keys.nitro && nitro > 0 && !keys.brake;
if (nitroActive) nitro = Math.max(0, nitro - dt * 34);
else nitro = Math.min(100, nitro + dt * 8);
const throttle = autoAccel || keys.accelerate;
const maxSpeed = spec.maxSpeed + (nitroActive ? 45 : 0);
if (keys.brake) actualSpeed = Math.max(0, actualSpeed - (45 + actualSpeed * 0.12) * dt);
else if (throttle) actualSpeed = Math.min(maxSpeed, actualSpeed + spec.acceleration * (nitroActive ? 1.55 : 1) * dt);
else actualSpeed = Math.max(0, actualSpeed - (2 + actualSpeed * 0.018) * dt);
if (Math.abs(player.position.x) > 7.5) actualSpeed = Math.max(0, actualSpeed - 20 * dt);
if (nitroActive && Math.random() < dt * 12) {
addSparks(player.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.3, -2.4)), 1);
}
updateWorld(dt);
updatePlayer(dt);
updateTraffic(dt, previousPlayer);
score += actualSpeed / 3.6 * dt;
$('score').textContent = Math.floor(score).toLocaleString();
$('speed').textContent = Math.round(actualSpeed * 0.58).toString();
$('nitro-fill').style.width = nitro + '%';
$('nitro-label').textContent = nitroActive ? 'BOOST' : nitro > 99 ? 'READY' : 'CHARGING';
const fast = THREE.MathUtils.clamp(actualSpeed / Math.max(1, spec.maxSpeed), 0, 1);
camera.fov = THREE.MathUtils.damp(camera.fov, 58 + fast * 12 + (nitroActive ? 3 : 0), 2, dt);
camera.updateProjectionMatrix();
camera.position.y = THREE.MathUtils.damp(camera.position.y, 5.5 - fast * 0.4, 2, dt);
camera.position.x = THREE.MathUtils.damp(camera.position.x, player.position.x * 0.3, 2.4, dt) + (cameraShake ? (Math.random() - 0.5) * cameraShake : 0);
camera.lookAt(player.position.x * 0.22, 1, -22 - fast * 6);
$('speed-lines').style.opacity = String(fast * 0.55);
updateAudio();
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
if (paused) showPage('pause-page');
else showPage('');
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
$('road-mode-toggle').addEventListener('click', () => {
roadMode = roadMode === 'one-way' ? 'two-way' : 'one-way';
save('tr-mode', roadMode);
for (const road of roads) scene.remove(road);
roads.length = 0;
for (let i = 0; i < 8; i++) createRoad(-i * 50);
clearTraffic();
syncSettings();
});
$('night-toggle').addEventListener('click', () => setNight(!night));
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
renderGarage();
refreshWallet();
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
animate();
