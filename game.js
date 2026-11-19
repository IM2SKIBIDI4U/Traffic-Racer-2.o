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
const trafficVehicles = [];
const particles = [];
const lanes = [-6.75, -2.25, 2.25, 6.75];
const keys = { left: false, right: false, accelerate: false, brake: false, drift: false, nitro: false };
const cars = [
  { id: 'starter', name: 'LEXUS LS 500H', color: 0x1678c8, cost: 0, maxSpeed: 175, acceleration: 25, handling: 8.3, modelStyle: 0 },
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
let roadMode = load('tr-mode', 'one-way');
if (!['one-way', 'two-way'].includes(roadMode)) roadMode = 'one-way';
let autoAccel = load('tr-auto', 'true') !== 'false';
let soundEnabled = load('tr-sound', 'true') !== 'false';
let night = load('tr-night', 'false') === 'true';

let player;
let playerLateral = lanes.at(2);
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
  return 18 * Math.sin((z + 55) / 235) + 6 * Math.sin(z / 112);
}
function roadHeading(z) {
  const delta = 0.5;
  const slope = (roadCenterX(z + delta) - roadCenterX(z - delta)) / (2 * delta);
  return Math.atan(slope);
}
function placeOnRoad(object, lateral, z, headingOffset = 0) {
  object.userData.roadZ = z;
  const heading = roadHeading(z);
  object.position.x = roadCenterX(z) + lateral * Math.cos(heading);
  object.position.z = z - lateral * Math.sin(heading);
  object.rotation.y = heading + headingOffset;
}

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
let roadSegmentLength = 50;

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
  if (startupLoadFinished || !starterLoadFinished || !trafficLoadFinished || !roadsideLoadFinished) return;
  startupLoadFinished = true;
  $('loading-fill').style.width = '100%';
  $('loading-progress').setAttribute('aria-valuenow', '100');
  $('loading-message').textContent = 'Vehicles and environment ready!';
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
        createTrafficVariants();
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
}
for (const child of player.userData.syntheticChildren || []) child.visible = true;
if (carId === 'starter') {
loadStarterModel()
.then((source) => {
if (selectedCar === carId) {
const model = prepareStarterModel(source);
player.userData.starterModel = model;
player.add(model);
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
const lateral = side * (14 + Math.random() * 2);
group.userData.roadLateral = lateral;
placeOnRoad(group, lateral, z + Math.random() * 7);
scene.add(group);
scenery.push(group);
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
}

// Load the two user-provided roadside GLBs. Normalize their pivots and sizes so
// they fit the game's road scale, and keep their meshes out of the shadow pass.
function normalizeRoadsideModel(source, targetSize, receiveShadow = true) {
  const model = source.clone(true);
  model.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const largest = Math.max(size.x, size.z);
  if (!Number.isFinite(largest) || largest <= 0) throw new Error('Roadside GLB has invalid dimensions');
  model.scale.multiplyScalar(targetSize / largest);
  model.updateWorldMatrix(true, true);
  const scaledBounds = new THREE.Box3().setFromObject(model);
  const center = scaledBounds.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -scaledBounds.min.y, -center.z);
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = receiveShadow;
    object.frustumCulled = true;
    object.geometry?.computeBoundingSphere();
    const mats = Array.isArray(object.material) ? object.material : [object.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.needsUpdate = true;
    }
  });
  return model;
}

let modularRoadTemplate = null;

function normalizeRoadSegment(source) {
  const model = source.clone(true);
  model.updateWorldMatrix(true, true);
  let bounds = new THREE.Box3().setFromObject(model);
  let size = bounds.getSize(new THREE.Vector3());
  if (size.x <= 0 || size.z <= 0) throw new Error('Road modular GLB has invalid dimensions');

  // Road pieces are authored with either X or Z as their long axis. Rotate
  // the model when needed so every segment runs forward along world Z.
  if (size.x > size.z) {
    model.rotation.y += Math.PI / 2;
    model.updateWorldMatrix(true, true);
    bounds = new THREE.Box3().setFromObject(model);
    size = bounds.getSize(new THREE.Vector3());
  }

  // Preserve the model's proportions. Do not stretch its length to an
  // assumed value: derive the repeat distance from the actual GLB bounds.
  const scale = 18 / size.x;
  model.scale.multiplyScalar(scale);
  model.updateWorldMatrix(true, true);
  const scaled = new THREE.Box3().setFromObject(model);
  const scaledSize = scaled.getSize(new THREE.Vector3());
  const center = scaled.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -scaled.min.y, -center.z);
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.receiveShadow = true;
    object.castShadow = false;
    object.frustumCulled = true;
    const mats = Array.isArray(object.material) ? object.material : [object.material];
    for (const mat of mats) {
      if (mat?.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      if (mat) mat.needsUpdate = true;
    }
  });
  // Keep the centering offset on a child. placeOnRoad() moves the outer
  // segment group, so putting this offset on the root would be overwritten.
  const segmentRoot = new THREE.Group();
  segmentRoot.add(model);
  segmentRoot.userData.segmentLength = scaledSize.z;
  return segmentRoot;
}

function buildModularRoadSegments() {
  if (!modularRoadTemplate) return false;
  for (const oldRoad of roads) scene.remove(oldRoad);
  roads.length = 0;
  roadSegmentLength = modularRoadTemplate.userData.segmentLength;
  for (let i = 0; i < 10; i++) {
    const segment = modularRoadTemplate.clone(true);
    segment.name = 'road-modular-segment';
    segment.userData.roadStation = -roadSegmentLength / 2 - i * roadSegmentLength;
    scene.add(segment);
    roads.push(segment);
  }
  return true;
}

function replaceRoadWithModularModel(source) {
  modularRoadTemplate = normalizeRoadSegment(source);
  buildModularRoadSegments();
}

function loadRoadsideModels() {
  const base = 'https://media.githubusercontent.com/media/IM2SKIBIDI4U/Traffic-Racer-2.o/main/';
  const loadOne = (file) => new Promise((resolve, reject) => {
    gltfLoader.load(base + file, (gltf) => resolve(gltf.scene), undefined, reject);
  });

  const roadPromise = loadOne('road_modular.glb').then((source) => {
    replaceRoadWithModularModel(source);
    console.info('Modular road loaded:', roadSegmentLength.toFixed(1), 'world units per segment');
  }).catch((error) => {
    // The procedural curved road created at startup remains as a safe fallback.
    console.error('Could not load modular road GLB; keeping procedural road:', error);
  });

  const stationPromise = loadOne('small_red_gas_station.glb').then((source) => {
    for (const side of [-1, 1]) {
      const station = normalizeRoadsideModel(source, 17, true);
      station.name = 'red-gas-station';
      station.userData.roadLateral = side * 23;
      placeOnRoad(station, side * 23, -105);
      scene.add(station);
      scenery.push(station);
    }
  }).catch((error) => {
    console.error('Could not load red gas station GLB:', error);
  });

  Promise.allSettled([roadPromise, stationPromise]).finally(() => {
    roadsideLoadFinished = true;
    finishLoadingScreen();
  });
}

function chooseTrafficLane() {
if (roadMode === 'one-way') return lanes[Math.floor(Math.random() * lanes.length)];
return Math.random() < 0.38 ? lanes[Math.floor(Math.random() * 2)] : lanes[2 + Math.floor(Math.random() * 2)];
}
function spawnTraffic() {
  if (traffic.length >= 16) return false;
  // Place traffic well beyond the visible driving area so it is already on the road before the player reaches it.
  const z = -225 - Math.random() * 30;
  const laneOptions = roadMode === 'one-way'
    ? [...lanes]
    : (Math.random() < 0.38 ? lanes.slice(0, 2) : lanes.slice(2));
  const availableLanes = laneOptions.filter((candidate) =>
    !traffic.some((item) => item.lane === candidate && Math.abs(item.pathZ - z) < 24)
  );
  if (!availableLanes.length) return false;
  const lane = availableLanes[Math.floor(Math.random() * availableLanes.length)];
  const oncoming = roadMode === 'two-way' && lane < 0;
  const botSpeed = 60 + Math.random() * 100;
  const colors = [0xe8e5dc, 0xb84238, 0x334f66, 0x8b9b92, 0xc59b4e, 0x252a32];
  let car;
  if (trafficVehicles.length) {
    const source = trafficVehicles[Math.floor(Math.random() * trafficVehicles.length)];
    car = source.clone(true);
    car.userData.wheels = getTrafficWheels(car);
    car.userData.collisionHalfWidth = source.userData.collisionHalfWidth;
    car.userData.collisionHalfLength = source.userData.collisionHalfLength;
  } else {
    car = createCar(colors[Math.floor(Math.random() * colors.length)], false, Math.floor(Math.random() * 4));
    // The procedural model's headlights are on +Z; rotate it to face forward (-Z).
    car.rotation.y = Math.PI;
  }
  const baseHeading = car.rotation.y;
  placeOnRoad(car, lane, z, baseHeading + (oncoming ? Math.PI : 0));
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
    lateralX: lane,
    pathZ: z,
    baseHeading,
    targetSpeed: botSpeed,
    targetLane: lane,
    laneChangeCooldown: 2 + Math.random() * 5,
    drivingStyle: Math.random(),
    checkedMiss: false,
    previousZ: z
  });
  return true;
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
  // Clear inline styles left by older result-screen handling so the hidden
  // class always controls visibility when changing pages.
  page.style.removeProperty('display');
  page.style.removeProperty('opacity');
  page.style.removeProperty('pointer-events');
  page.style.removeProperty('z-index');
});
if (id) $(id).classList.remove('hidden');
}
function showMenu() {
  running = false;
  paused = false;
  actualSpeed = 0;
  nitroActive = false;
  Object.keys(keys).forEach((key) => { keys[key] = false; });
  showPage('main-menu');
}
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
if ($('game-over')) $('game-over').style.display = '';
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
playerLateral = lanes.at(2);
placeOnRoad(player, playerLateral, 7);
player.rotation.set(0, roadHeading(7), 0);
updateCamera(0, 0);
clearTraffic();
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
if (traffic.length === 0) spawnTraffic();
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
toast.innerHTML = 'NEAR MISS! +' + reward + '';
toast.classList.add('show');
window.clearTimeout(showNearMiss.timeout);
showNearMiss.timeout = window.setTimeout(() => toast.classList.remove('show'), 950);
}
function finishGame() {
  if (!running) return;
  running = false;
  paused = false;
  actualSpeed = 0;
  steerVelocity = 0;
  nitroActive = false;
  cameraShake = 0.5;
  // update() stops once the game ends, so apply the crash jolt here.
  camera.position.x += (Math.random() - 0.5) * cameraShake;
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
  const station = (road.userData.roadStation ?? road.position.z) + move;
  const loopLength = roads.length * roadSegmentLength;
  road.userData.roadStation = station >= 25 ? station - loopLength : station;
  placeOnRoad(road, 0, road.userData.roadStation);
}
for (const prop of scenery) {
  let roadZ = (prop.userData.roadZ ?? prop.position.z) + move;
  if (roadZ > 28) roadZ -= 270;
  prop.userData.roadZ = roadZ;
  const lateral = prop.userData.roadLateral ?? prop.position.x;
  prop.userData.roadLateral = lateral;
  const y = prop.position.y;
  placeOnRoad(prop, lateral, roadZ);
  prop.position.y = y;
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
playerLateral = THREE.MathUtils.clamp(playerLateral + steerVelocity * dt, -8, 8);
const steeringYaw = THREE.MathUtils.damp(player.userData.steeringYaw || 0, -steer * (drifting ? 0.1 : 0.04), 7, dt);
player.userData.steeringYaw = steeringYaw;
placeOnRoad(player, playerLateral, 7, steeringYaw);
player.rotation.z = THREE.MathUtils.damp(player.rotation.z, -steerVelocity * 0.022 * (drifting ? 0.7 : 1), 7, dt);
player.userData.body.position.y = player.userData.bodyBaseY + Math.sin(performance.now() * 0.008) * Math.min(0.025, actualSpeed / 12000);
for (const wheel of player.userData.wheels) wheel.rotation.x += actualSpeed / 3.6 * dt * 0.85;
}
function updateTraffic(dt, previousPlayer) {
  if (!running) return;

  if (burstTimer > 0) burstTimer -= dt;
  else if ((burstCooldown -= dt) <= 0) {
    burstTimer = 4 + Math.random() * 3;
    burstCooldown = 13 + Math.random() * 14;
    spawnTimer = 0;
  }
  // Keep a buffer of traffic far ahead. This replenishes the road before fast
  // driving brings the player close enough to notice newly spawned vehicles.
  const trafficAhead = traffic.filter((item) => item.pathZ < -35).length;
  spawnTimer -= dt;
  if (spawnTimer <= 0 && trafficAhead < 10) {
    const dense = burstTimer > 0;
    const count = dense && Math.random() < 0.3 ? 2 : 1;
    let spawned = 0;
    for (let i = 0; i < count && traffic.length < 16; i++) {
      if (spawnTraffic()) spawned++;
    }
    // Refill the distant traffic buffer more frequently at high speed.
    spawnTimer = spawned === 0
      ? 0.15
      : dense ? 0.22 + Math.random() * 0.2 : 0.25 + Math.random() * 0.2;
  }

  const oldPositions = new Map(traffic.map((item) => [item, item.pathZ]));
  const playerMps = actualSpeed / 3.6 * 2;

  for (const item of traffic) {
    // Simple driver AI: look for a slower vehicle ahead and decide whether
    // to slow down or safely move into a neighbouring lane to pass it.
    if (!item.oncoming) {
      item.laneChangeCooldown -= dt;
      const leader = traffic
        .filter((other) => other !== item && !other.oncoming && other.lane === item.lane && other.pathZ < item.pathZ)
        .sort((a, b) => b.pathZ - a.pathZ)[0];
      const gap = leader ? item.pathZ - leader.pathZ : Infinity;
      const desiredCruise = item.targetSpeed;

      if (leader && gap < 30 && item.laneChangeCooldown <= 0 && item.drivingStyle > 0.28) {
        const laneOptions = roadMode === 'one-way'
          ? lanes
          : lanes.slice(2);
        const alternatives = laneOptions.filter((candidate) => candidate !== item.lane &&
          !traffic.some((other) => other !== item && !other.oncoming && other.lane === candidate && Math.abs(other.pathZ - item.pathZ) < 34)
        );
        if (alternatives.length) {
          item.targetLane = alternatives.sort((a, b) => Math.abs(a - item.lane) - Math.abs(b - item.lane))[0];
          item.lane = item.targetLane;
          item.laneChangeCooldown = 5 + Math.random() * 7;
        }
      }

      const followingSpeed = leader && gap < 22
        ? Math.max(35, leader.botSpeed - (22 - gap) * 2.2)
        : desiredCruise;
      item.botSpeed = THREE.MathUtils.damp(item.botSpeed, Math.min(desiredCruise, followingSpeed), 1.8, dt);
      item.lateralX = THREE.MathUtils.damp(item.lateralX, item.targetLane, 2.8, dt);
    }

    const botMps = item.botSpeed / 3.6 * 2;
    item.pathZ += (item.oncoming ? playerMps + botMps : playerMps - botMps) * dt;
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
    group.sort((a, b) => oldPositions.get(b) - oldPositions.get(a));
    for (let index = 1; index < group.length; index++) {
      const leader = group[index - 1];
      const follower = group[index];
      const safeGap = (leader.mesh.userData.collisionHalfLength || 2.2) + (follower.mesh.userData.collisionHalfLength || 2.2) + 2.5;
      follower.pathZ = Math.min(follower.pathZ, leader.pathZ - safeGap);
    }
  }
  // Convert each bot's lane-relative position onto the same curved centerline.
  for (const item of traffic) {
    const headingOffset = item.baseHeading + (item.oncoming ? Math.PI : 0);
    placeOnRoad(item.mesh, item.lateralX, item.pathZ, headingOffset);
  }

  for (let index = traffic.length - 1; index >= 0; index--) {
    const item = traffic[index];
    const newZ = item.pathZ;
    const prevRelZ = oldPositions.get(item) - previousPlayer.z;
    const nextRelZ = newZ - 7;
    const relDeltaZ = nextRelZ - prevRelZ;
    const t = relDeltaZ === 0 ? 0 : THREE.MathUtils.clamp(-prevRelZ / relDeltaZ, 0, 1);
    const closestZ = prevRelZ + relDeltaZ * t;
    const closestPlayerX = THREE.MathUtils.lerp(previousPlayer.x, player.position.x, t);
    const dx = Math.abs(closestPlayerX - item.mesh.position.x);

    if (
      Math.abs(closestZ) < (player.userData.collisionHalfLength || 2.1) + (item.mesh.userData.collisionHalfLength || 2.1) &&
      dx < (player.userData.collisionHalfWidth || 1.05) + (item.mesh.userData.collisionHalfWidth || 1.05)
    ) {
      console.log('Hit vehicle:', item.mesh.name || 'unnamed', 'at', item.mesh.position.toArray());
      // Let finishGame() perform the state transition. Setting running=false
      // here first makes its guard return early and skips the crash screen.
      finishGame();
      return;
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
const previousPlayer = { x: player.position.x, z: 7 };
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
$('speed').textContent = Math.round(actualSpeed).toString();
$('nitro-fill').style.width = nitro + '%';
$('nitro-label').textContent = nitroActive ? 'BOOST' : nitro > 99 ? 'READY' : 'CHARGING';
const fast = THREE.MathUtils.clamp(actualSpeed / Math.max(1, spec.maxSpeed), 0, 1);
updateCamera(dt, fast);
$('speed-lines').style.opacity = String(fast * 0.55);
updateAudio();
}
function updateCamera(dt, fast) {
camera.fov = THREE.MathUtils.damp(camera.fov, 68 + fast * 8 + (nitroActive ? 2 : 0), 2, dt);
camera.updateProjectionMatrix();
const position = player.localToWorld(new THREE.Vector3(0, 1.35, 0.15));
const target = player.localToWorld(new THREE.Vector3(0, 1.3, -35 - fast * 8));
if (dt === 0) camera.position.copy(position);
else camera.position.lerp(position, 1 - Math.exp(-8 * dt));
if (cameraShake) camera.position.x += (Math.random() - 0.5) * cameraShake;
camera.lookAt(target);
applyCameraMode(camera, player, dt);
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
for (const road of roads) {
  scene.remove(road);
  road.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const mat of materials) {
      // These materials are shared by the replacement road sections.
      if (mat && mat !== roadMat && mat !== whiteLine && mat !== yellowLine) mat.dispose();
    }
  });
}
roads.length = 0;
if (!buildModularRoadSegments()) {
  roadSegmentLength = 50;
  for (let i = 0; i < 8; i++) createRoad(-i * 50);
}
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
