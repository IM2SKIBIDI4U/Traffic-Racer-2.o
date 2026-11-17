import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  document.body.innerHTML = '<p style="padding:2rem;color:white;font:16px sans-serif">This game needs a browser with WebGL enabled. Try a current browser with WebGL turned on.</p>';
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const dayColor = new THREE.Color(0x9bbdd0);
const nightColor = new THREE.Color(0x071321);
scene.background = dayColor;
scene.fog = new THREE.Fog(dayColor, 42, 190);
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 500);
camera.position.set(0, 6.2, 15.8);
camera.lookAt(0, 1.1, -22);

const hemisphere = new THREE.HemisphereLight(0xd8efff, 0x455448, 1.5);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xffe6c6, 2.4);
sun.position.set(-18, 30, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -22;
sun.shadow.camera.right = 22;
sun.shadow.camera.top = 28;
sun.shadow.camera.bottom = -22;
scene.add(sun);

const clock = new THREE.Clock();
const roadSegments = [];
const scenery = [];
const traffic = [];
const particles = [];
const grounds = [];
// Four 4.5-unit lanes, from left edge to right edge.
const lanes = [-6.75, -2.25, 2.25, 6.75];
const keys = { left: false, right: false, drift: false, nitro: false };
let player;
let score = 0;
let speed = 0;
let steerVelocity = 0;
let nitro = 100;
let nitroActive = false;
let running = false;
let night = false;
let soundEnabled = true;
let spawnTimer = 1;
let burstTimer = 0;
let burstCooldown = 9;
let cameraShake = 0;
let audioContext;
let engineOscillator;
let engineGain;
let soundFilter;
let driftSoundTimer = 0;
let roadMode = localStorage.getItem('tr-mode') || 'one-way';

const cars = [
  { id: 'starter', name: 'ROADSTER', color: 0x1678c8, cost: 0, maxSpeed: 175, acceleration: 25, handling: 8.3 },
  { id: 'rally', name: 'RALLY GT', color: 0xd54b3e, cost: 500, maxSpeed: 205, acceleration: 34, handling: 9.2 },
  { id: 'midnight', name: 'MIDNIGHT', color: 0x403f70, cost: 1100, maxSpeed: 225, acceleration: 27, handling: 7.8 },
  { id: 'sunset', name: 'SUNSET', color: 0xe9a33b, cost: 1800, maxSpeed: 195, acceleration: 39, handling: 10.2 },
  { id: 'emerald', name: 'EMERALD', color: 0x328260, cost: 0, maxSpeed: 240, acceleration: 31, handling: 8.5 },
  { id: 'silver', name: 'SILVERLINE', color: 0xb8c3c6, cost: 4200, maxSpeed: 260, acceleration: 36, handling: 9.0 },
];
let credits = Number(localStorage.getItem('tr-credits')) || 0;
let owned;
try { owned = new Set(JSON.parse(localStorage.getItem('tr-owned') || '["starter"]')); }
catch { owned = new Set(['starter']); }
let selectedCar = localStorage.getItem('tr-car') || 'starter';
if (!owned.has(selectedCar) || !cars.some((car) => car.id === selectedCar)) selectedCar = 'starter';
const mat = (color, roughness = 0.65, metalness = 0.05, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

function makeAsphaltTexture() {
  const canvasTexture = document.createElement('canvas');
  canvasTexture.width = canvasTexture.height = 256;
  const ctx = canvasTexture.getContext('2d');
  ctx.fillStyle = '#303943';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4200; i += 1) {
    const shade = 45 + Math.random() * 40;
    ctx.fillStyle = `rgba(${shade},${shade + 3},${shade + 7},${Math.random() * 0.18})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1);
  }
  const texture = new THREE.CanvasTexture(canvasTexture);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 3);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const asphalt = makeAsphaltTexture();
const roadMaterial = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.94 });
const whiteLine = mat(0xe4e1d3, 0.82);
const yellowLine = mat(0xf0c94a, 0.8);
const shoulderMaterial = mat(0x8c9290, 0.9);
const grassMaterial = mat(0x59745d, 1);

function addRoadSegment(z) {
  const group = new THREE.Group();
  const road = new THREE.Mesh(new THREE.BoxGeometry(18, 0.22, 50), roadMaterial);
  road.position.y = -0.02;
  road.receiveShadow = true;
  group.add(road);

  // Solid outer edges, plus three dividers for exactly four lanes.
  for (const x of [-9, 9]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.04, 50), whiteLine);
    edge.position.set(x, 0.105, 0);
    group.add(edge);
  }
  for (const x of [-4.5, 0, 4.5]) {
    if (roadMode === 'two-way' && x === 0) {
      for (const offset of [-0.12, 0.12]) {
        const center = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 50), yellowLine);
        center.position.set(offset, 0.11, 0);
        group.add(center);
      }
      continue;
    }
    for (let dz = -22; dz < 25; dz += 10) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 4.8), whiteLine);
      dash.position.set(x, 0.11, dz);
      group.add(dash);
    }
  }
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 50), shoulderMaterial);
    shoulder.position.set(side * 10.5, -0.06, 0);
    shoulder.receiveShadow = true;
    group.add(shoulder);
  }
  group.position.z = z;
  scene.add(group);
  roadSegments.push(group);
}

function createCar(color, isPlayer = false, style = 0) {
  const car = new THREE.Group();
  const paint = mat(color, 0.27, 0.58, { clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const glass = mat(0x172b37, 0.18, 0.35, { transparent: true, opacity: 0.88 });
  const rubber = mat(0x111417, 0.92);
  const rim = mat(0xa6b2b4, 0.25, 0.8);
  const width = style === 1 ? 2.18 : 1.95;
  const length = style === 1 ? 4.8 : 4.2;
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, 0.72, length), paint);
  body.position.y = 0.68;
  body.castShadow = true;
  car.add(body);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(width * 0.92, 0.18, 1.12), paint);
  hood.position.set(0, 1.05, 1.3);
  car.add(hood);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(width * 0.76, 0.68, 1.95), paint);
  cabin.position.set(0, 1.22, -0.32);
  car.add(cabin);
  for (const side of [-1, 1]) {
    const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.38, 1.13), glass);
    windowMesh.position.set(side * width * 0.39, 1.28, -0.3);
    car.add(windowMesh);
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.16, 0.1), mat(0xfaf2d8, 0.25, 0.15, { emissive: 0xffe7b0, emissiveIntensity: 0.35 }));
    headlight.position.set(side * 0.55, 0.78, length / 2 + 0.025);
    car.add(headlight);
    const rearLamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.08), mat(0xd2231a, 0.3, 0.1, { emissive: 0x5c0805 }));
    rearLamp.position.set(side * 0.55, 0.78, -length / 2 - 0.02);
    car.add(rearLamp);
    for (const z of [1.25, -1.35]) {
      const wheel = new THREE.Group();
      wheel.position.set(side * (width / 2 + 0.02), 0.38, z);
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.27, 20), rubber);
      tire.rotation.z = Math.PI / 2;
      wheel.add(tire);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.285, 16), rim);
      hub.rotation.z = Math.PI / 2;
      wheel.add(hub);
      car.add(wheel);
    }
  }
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(width * 0.94, 0.2, 0.22), mat(0x20272a, 0.45, 0.3));
  bumper.position.set(0, 0.37, length / 2);
  car.add(bumper);
  const rearBumper = bumper.clone();
  rearBumper.position.z = -length / 2;
  car.add(rearBumper);
  if (isPlayer) {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.11, 0.25), mat(0x101820, 0.38, 0.5));
    spoiler.position.set(0, 1.05, -2.02);
    car.add(spoiler);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.035, 2.7), new THREE.MeshBasicMaterial({ color: 0x36bfff, transparent: true, opacity: 0.38 }));
    glow.position.y = 0.19;
    car.add(glow);
  }
  car.userData.body = body;
  car.userData.paint = paint;
  return car;
}

function createPlayer() {
  const selected = cars.find((car) => car.id === selectedCar) || cars[0];
  player = createCar(selected.color, true);
  player.position.set(lanes[2], 0, 7);
  scene.add(player);
  const headlamp = new THREE.SpotLight(0xe5f5ff, 0, 55, Math.PI / 7, 0.55, 1.5);
  headlamp.position.set(0, 1.5, 2.1);
  headlamp.target.position.set(0, 0, -32);
  player.add(headlamp, headlamp.target);
  player.userData.headlamp = headlamp;
}

function addWorld() {
  for (let i = 0; i < 8; i += 1) addRoadSegment(-i * 50);
  for (let i = 0; i < 2; i += 1) {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 600), grassMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.2, -250 - i * 600);
    ground.receiveShadow = true;
    scene.add(ground);
    grounds.push(ground);
  }
  for (let z = -190; z < 40; z += 18) {
    for (const side of [-1, 1]) {
      const group = new THREE.Group();
      const x = side * (13.5 + Math.random() * 2.4);
      if (Math.random() < 0.53) {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.22, 1.6, 8), mat(0x604732, 1));
        trunk.position.y = 0.8;
        group.add(trunk);
        const crown = new THREE.Mesh(new THREE.ConeGeometry(1.05, 2.8, 9), mat(Math.random() < 0.5 ? 0x38694a : 0x4c7950, 1));
        crown.position.y = 2.45;
        group.add(crown);
      } else {
        const height = 3 + Math.random() * 7;
        const building = new THREE.Mesh(new THREE.BoxGeometry(2.6 + Math.random() * 2, height, 3 + Math.random() * 3), mat(0x59666c, 0.9));
        building.position.y = height / 2 - 0.1;
        group.add(building);
      }
      group.position.set(x, 0, z + Math.random() * 9);
      scene.add(group);
      scenery.push(group);
    }
  }
}

function pickTrafficLane() {
  if (roadMode === 'one-way') return lanes[Math.floor(Math.random() * lanes.length)];
  // In two-way traffic the right two lanes flow with the player; left two are oncoming.
  const oncoming = Math.random() < 0.34;
  return oncoming ? lanes[Math.floor(Math.random() * 2)] : lanes[2 + Math.floor(Math.random() * 2)];
}

function spawnTraffic() {
  const lane = pickTrafficLane();
  // Most traffic is slower than the player. A smaller number of fast cars can catch up.
  const botSpeed = 65 + Math.random() * 105;
  const oncoming = roadMode === 'two-way' && lane < 0;
  const colors = [0xe8e5dc, 0xb84238, 0x334f66, 0x8b9b92, 0xc59b4e, 0x252a32];
  const car = createCar(colors[Math.floor(Math.random() * colors.length)], false, Math.random() < 0.25 ? 1 : 0);
  car.position.set(lane, 0, -92 - Math.random() * 28);
  if (oncoming) car.rotation.y = Math.PI;
  if (night) {
    const glow = new THREE.PointLight(0xffe4b7, 0.55, 12, 2);
    glow.position.set(0, 0.8, oncoming ? -2.8 : 2.8);
    car.add(glow);
  }
  scene.add(car);
  // Positive relative velocity brings the vehicle toward the player at the camera.
  const playerMps = speed / 3.6;
  const relativeSpeed = oncoming ? playerMps + botSpeed / 3.6 : playerMps - botSpeed / 3.6;
  traffic.push({ mesh: car, lane, botSpeed, oncoming, relativeSpeed });
}

function clearTraffic() {
  for (const item of traffic) scene.remove(item.mesh);
  traffic.length = 0;
}

function initAudio() {
  if (!soundEnabled || audioContext) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext = new AudioContextClass();
  engineOscillator = audioContext.createOscillator();
  engineOscillator.type = 'sawtooth';
  soundFilter = audioContext.createBiquadFilter();
  soundFilter.type = 'lowpass';
  soundFilter.frequency.value = 230;
  engineGain = audioContext.createGain();
  engineGain.gain.value = 0;
  engineOscillator.connect(soundFilter).connect(engineGain).connect(audioContext.destination);
  engineOscillator.start();
}
function oneShot(freq, duration, type = 'sine', volume = 0.08) {
  if (!soundEnabled) return;
  initAudio();
  if (!audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.value = freq;
  gain.gain.setValueAtTime(volume, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}
function updateAudio() {
  if (!audioContext || !engineOscillator) return;
  if (audioContext.state === 'suspended') audioContext.resume();
  engineOscillator.frequency.setTargetAtTime(55 + speed * 1.5 + (nitroActive ? 35 : 0), audioContext.currentTime, 0.08);
  soundFilter.frequency.setTargetAtTime(140 + speed * 3, audioContext.currentTime, 0.12);
  engineGain.gain.setTargetAtTime(running ? (nitroActive ? 0.055 : 0.027) : 0, audioContext.currentTime, 0.12);
}

function setNight(value) {
  night = value;
  const color = night ? nightColor : dayColor;
  scene.background.copy(color);
  scene.fog.color.copy(color);
  hemisphere.intensity = night ? 0.43 : 1.5;
  sun.intensity = night ? 0.12 : 2.4;
  sun.color.set(night ? 0x9ab8ff : 0xffe6c6);
  if (player?.userData.headlamp) player.userData.headlamp.intensity = night ? 2.8 : 0;
  $('night-button').textContent = night ? '☾' : '☼';
}

function addSparks(position, amount = 24) {
  for (let i = 0; i < amount; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.045 + Math.random() * 0.05, 5, 5), new THREE.MeshBasicMaterial({ color: [0xffd27a, 0xff783d, 0xe9f7ff][i % 3] }));
    mesh.position.copy(position);
    scene.add(mesh);
    particles.push({ mesh, velocity: new THREE.Vector3((Math.random() - 0.5) * 13, Math.random() * 8, (Math.random() - 0.5) * 13), life: 0.35 + Math.random() * 0.55 });
  }
}

function refreshWallet() {
  $('wallet').textContent = credits.toLocaleString();
  $('menu-wallet').textContent = credits.toLocaleString();
  $('garage-wallet').textContent = credits.toLocaleString();
}
function renderGarage() {
  const list = $('car-list');
  list.innerHTML = '';
  for (const car of cars) {
    const isOwned = owned.has(car.id);
    const card = document.createElement('button');
    card.className = `car-card${selectedCar === car.id ? ' selected' : ''}`;
    card.style.setProperty('--car-color', `#${car.color.toString(16).padStart(6, '0')}`);
    const status = isOwned ? (selectedCar === car.id ? 'SELECTED' : 'OWNED') : `◆ ${car.cost.toLocaleString()}`;
    card.innerHTML = `<span class="car-swatch"></span><span class="car-name">${car.name}</span><span class="car-cost ${isOwned ? 'owned' : ''}">${status}</span><span class="car-cost">${car.maxSpeed} km/h · ${car.acceleration} accel</span>`;
    card.addEventListener('click', () => {
      if (isOwned) {
        selectedCar = car.id;
        localStorage.setItem('tr-car', car.id);
        player.userData.paint.color.setHex(car.color);
        renderGarage();
        return;
      }
      if (credits < car.cost) {
        card.querySelector('.car-cost').textContent = `NEED ${(car.cost - credits).toLocaleString()} MORE`;
        return;
      }
      credits -= car.cost;
      owned.add(car.id);
      localStorage.setItem('tr-credits', credits);
      localStorage.setItem('tr-owned', JSON.stringify([...owned]));
      selectedCar = car.id;
      localStorage.setItem('tr-car', car.id);
      player.userData.paint.color.setHex(car.color);
      refreshWallet();
      renderGarage();
    });
    list.append(card);
  }
  document.querySelectorAll('.mode-button').forEach((button) => button.classList.toggle('selected', button.dataset.mode === roadMode));
  $('mode-description').textContent = roadMode === 'one-way'
    ? 'All four lanes flow in your direction. Find gaps and pass safely.'
    : 'Two lanes each way. Oncoming traffic uses the left two lanes behind the double-yellow divider.';
  refreshWallet();
}
function openGarage() {
  running = false;
  $('start-overlay').classList.add('hidden');
  $('game-over').classList.add('hidden');
  $('garage-overlay').classList.remove('hidden');
  renderGarage();
}

function startGame() {
  score = 0;
  speed = 0;
  nitro = 100;
  steerVelocity = 0;
  spawnTimer = 0.9;
  burstTimer = 0;
  burstCooldown = 7 + Math.random() * 6;
  running = true;
  nitroActive = false;
  cameraShake = 0;
  player.position.set(lanes[2], 0, 7);
  player.rotation.set(0, 0, 0);
  clearTraffic();
  for (const particle of particles) scene.remove(particle.mesh);
  particles.length = 0;
  $('score').textContent = '0';
  $('speed').textContent = '0';
  $('nitro-fill').style.width = '100%';
  $('start-overlay').classList.add('hidden');
  $('game-over').classList.add('hidden');
  $('garage-overlay').classList.add('hidden');
  if (soundEnabled) {
    initAudio();
    if (audioContext?.state === 'suspended') audioContext.resume();
  }
}
function gameOver() {
  if (!running) return;
  running = false;
  nitroActive = false;
  cameraShake = 0.8;
  addSparks(player.position.clone().add(new THREE.Vector3(0, 0.7, 0)), 42);
  oneShot(90, 0.65, 'sawtooth', 0.16);
  const earned = Math.max(15, Math.floor(score / 30));
  credits += earned;
  localStorage.setItem('tr-credits', credits);
  refreshWallet();
  $('earned-credits').textContent = `+${earned} credits`;
  const flash = $('crash-flash');
  flash.style.transition = 'none';
  flash.style.opacity = '0.75';
  requestAnimationFrame(() => { flash.style.transition = 'opacity .55s'; flash.style.opacity = '0'; });
  $('final-score').innerHTML = `${Math.floor(score).toLocaleString()} <small>METERS</small>`;
  setTimeout(() => $('game-over').classList.remove('hidden'), 500);
}

function updateRoad(delta) {
  const movement = speed / 3.6 * delta;
  for (const segment of roadSegments) {
    segment.position.z += movement;
    if (segment.position.z > 50) segment.position.z -= roadSegments.length * 50;
  }
  for (const prop of scenery) {
    prop.position.z += movement;
    if (prop.position.z > 30) prop.position.z -= 240;
  }
  for (const ground of grounds) {
    ground.position.z += movement;
    if (ground.position.z > 350) ground.position.z -= 1200;
  }
  asphalt.offset.y -= movement * 0.018;
}

function updatePlayer(delta) {
  const selected = cars.find((car) => car.id === selectedCar) || cars[0];
  const input = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const drifting = keys.drift && Math.abs(input) > 0;
  const handling = selected.handling * (drifting ? 1.28 : 1);
  const targetVelocity = input * handling;
  steerVelocity = THREE.MathUtils.damp(steerVelocity, targetVelocity, drifting ? 4 : 8, delta);
  player.position.x = THREE.MathUtils.clamp(player.position.x + steerVelocity * delta, -8.0, 8.0);
  player.rotation.z = THREE.MathUtils.damp(player.rotation.z, -steerVelocity * 0.025 * (drifting ? 0.56 : 1), 8, delta);
  player.rotation.y = THREE.MathUtils.damp(player.rotation.y, -input * (drifting ? 0.11 : 0.045), 7, delta);
  player.userData.body.position.y = 0.68 + Math.sin(performance.now() * 0.009) * 0.012;
  if (drifting && Math.abs(input) > 0 && Math.random() < delta * 16) {
    addSparks(player.position.clone().add(new THREE.Vector3(-Math.sign(input), 0.2, -1.5)), 1);
    score += delta * 8;
    driftSoundTimer -= delta;
    if (driftSoundTimer <= 0) {
      oneShot(260, 0.13, 'triangle', 0.018);
      driftSoundTimer = 0.2;
    }
  }
  if (Math.abs(player.position.x) > 7.55) speed = Math.max(55, speed - delta * 38);
}

function maybeStartTrafficBurst(delta) {
  if (burstTimer > 0) {
    burstTimer -= delta;
    return;
  }
  burstCooldown -= delta;
  if (burstCooldown <= 0) {
    // Periodically send a dense pack, then return to lighter traffic.
    burstTimer = 4.5 + Math.random() * 4;
    burstCooldown = 13 + Math.random() * 13;
    spawnTimer = 0;
  }
}
function trySpawnTraffic() {
  if (traffic.length >= 16) return;
  const lane = pickTrafficLane();
  const z = -92 - Math.random() * 28;
  // Keep the new car clear of another car in the same lane.
  if (traffic.some((item) => item.lane === lane && Math.abs(item.mesh.position.z - z) < 24)) return;
  const botSpeed = 55 + Math.random() * 125;
  const oncoming = roadMode === 'two-way' && lane < 0;
  const colors = [0xe8e5dc, 0xb84238, 0x334f66, 0x8b9b92, 0xc59b4e, 0x252a32];
  const car = createCar(colors[Math.floor(Math.random() * colors.length)], false, Math.random() < 0.25 ? 1 : 0);
  car.position.set(lane, 0, z);
  if (oncoming) car.rotation.y = Math.PI;
  if (night) {
    const glow = new THREE.PointLight(0xffe4b7, 0.55, 12, 2);
    glow.position.set(0, 0.8, oncoming ? -2.8 : 2.8);
    car.add(glow);
  }
  scene.add(car);
  const playerMps = speed / 3.6;
  const relativeSpeed = oncoming ? playerMps + botSpeed / 3.6 : playerMps - botSpeed / 3.6;
  traffic.push({ mesh: car, lane, botSpeed, oncoming, relativeSpeed });
}
function updateTraffic(delta) {
  maybeStartTrafficBurst(delta);
  spawnTimer -= delta;
  if (spawnTimer <= 0) {
    const dense = burstTimer > 0;
    const count = dense ? (Math.random() < 0.35 ? 2 : 1) : 1;
    for (let i = 0; i < count; i += 1) trySpawnTraffic();
    spawnTimer = dense ? 0.24 + Math.random() * 0.18 : 0.7 + Math.random() * 0.5;
  }
  for (let i = traffic.length - 1; i >= 0; i -= 1) {
    const item = traffic[i];
    const playerMps = speed / 3.6;
    item.relativeSpeed = item.oncoming ? playerMps + item.botSpeed / 3.6 : playerMps - item.botSpeed / 3.6;
    item.mesh.position.z += item.relativeSpeed * delta;
    if (item.mesh.position.z > 24 || item.mesh.position.z < -145) {
      scene.remove(item.mesh);
      traffic.splice(i, 1);
      if (item.mesh.position.z > 24) score += 12;
      continue;
    }
    if (Math.abs(player.position.x - item.mesh.position.x) < 1.62 && Math.abs(player.position.z - item.mesh.position.z) < 3.15) {
      gameOver();
      return;
    }
  }
}

function updateParticles(delta) {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    particle.life -= delta;
    particle.velocity.y -= 12 * delta;
    particle.mesh.position.addScaledVector(particle.velocity, delta);
    if (particle.life <= 0) {
      scene.remove(particle.mesh);
      particle.mesh.geometry.dispose();
      particle.mesh.material.dispose();
      particles.splice(i, 1);
    }
  }
}
function update(delta) {
  updateParticles(delta);
  if (!running) {
    cameraShake = Math.max(0, cameraShake - delta * 2.2);
    return;
  }
  const selected = cars.find((car) => car.id === selectedCar) || cars[0];
  nitroActive = keys.nitro && nitro > 0;
  if (nitroActive) nitro = Math.max(0, nitro - delta * 34);
  else nitro = Math.min(100, nitro + delta * 9);
  const topSpeed = selected.maxSpeed + (nitroActive ? 55 : 0);
  // Cars now accelerate from a standstill, and each garage car has its own acceleration and top speed.
  speed = Math.min(topSpeed, speed + selected.acceleration * (nitroActive ? 1.55 : 1) * delta);
  if (Math.abs(player.position.x) > 7.55) speed = Math.max(55, speed - delta * 38);
  if (nitroActive && Math.random() < delta * 18) addSparks(player.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.3, -2.6)), 1);
  updateRoad(delta);
  updatePlayer(delta);
  updateTraffic(delta);
  score += delta * speed / 3.6 * 1.5;
  $('score').textContent = Math.floor(score).toLocaleString();
  $('speed').textContent = Math.round(speed).toString();
  $('nitro-fill').style.width = `${nitro}%`;
  $('nitro-label').textContent = nitroActive ? 'BOOST' : nitro > 99 ? 'READY' : 'CHARGING';
  camera.position.x = THREE.MathUtils.damp(camera.position.x, player.position.x * 0.32, 2.6, delta);
  camera.position.y = THREE.MathUtils.damp(camera.position.y, nitroActive ? 6 : 6.2, 2, delta);
  camera.lookAt(player.position.x * 0.25, 1.05, -24);
  if (cameraShake > 0) camera.position.x += (Math.random() - 0.5) * cameraShake;
  updateAudio();
}

function resize() {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
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
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['arrowleft', 'arrowright', ' ', 'shift'].includes(key)) event.preventDefault();
  if (key === 'arrowleft' || key === 'a') setControl('left', true);
  if (key === 'arrowright' || key === 'd') setControl('right', true);
  if (key === ' ') setControl('drift', true);
  if (key === 'shift') setControl('nitro', true);
  if (key === 'n' && !event.repeat) setNight(!night);
}, { passive: false });
window.addEventListener('keyup', (event) => {
  const key = event.key.toLowerCase();
  if (key === 'arrowleft' || key === 'a') setControl('left', false);
  if (key === 'arrowright' || key === 'd') setControl('right', false);
  if (key === ' ') setControl('drift', false);
  if (key === 'shift') setControl('nitro', false);
});
window.addEventListener('blur', () => Object.keys(keys).forEach((key) => { keys[key] = false; }));
document.querySelectorAll('[data-control]').forEach((button) => {
  const control = button.dataset.control;
  const release = (event) => { event.preventDefault(); setControl(control, false); button.classList.remove('active'); };
  button.addEventListener('pointerdown', (event) => { event.preventDefault(); button.setPointerCapture?.(event.pointerId); setControl(control, true); button.classList.add('active'); });
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
});

$('start-button').addEventListener('click', startGame);
$('restart-button').addEventListener('click', startGame);
$('menu-garage-button').addEventListener('click', openGarage);
$('garage-button').addEventListener('click', openGarage);
$('result-garage-button').addEventListener('click', openGarage);
$('garage-back-button').addEventListener('click', () => {
  $('garage-overlay').classList.add('hidden');
  $('start-overlay').classList.remove('hidden');
});
$('garage-drive-button').addEventListener('click', startGame);
document.querySelectorAll('.mode-button').forEach((button) => button.addEventListener('click', () => {
  roadMode = button.dataset.mode;
  localStorage.setItem('tr-mode', roadMode);
  renderGarage();
}));
$('night-button').addEventListener('click', () => setNight(!night));
$('sound-button').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  $('sound-button').textContent = soundEnabled ? '♫' : '♪';
  if (!soundEnabled && audioContext) engineGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.05);
  if (soundEnabled && running) initAudio();
});

addWorld();
createPlayer();
setNight(false);
renderGarage();
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
animate();
