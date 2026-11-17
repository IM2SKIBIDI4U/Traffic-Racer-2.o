import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const scoreEl = $('score');
const speedEl = $('speed');
const nitroFill = $('nitro-fill');
const nitroLabel = $('nitro-label');
const startOverlay = $('start-overlay');
const gameOverOverlay = $('game-over');
const finalScoreEl = $('final-score');
const crashFlash = $('crash-flash');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  document.body.innerHTML = '<p style="padding:2rem;color:white;font:16px sans-serif">This game needs a browser with WebGL enabled. Try a current version of Chrome, Edge, Firefox, or Safari.</p>';
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
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 350);
camera.position.set(0, 6.2, 15.8);
camera.lookAt(0, 1.1, -22);

const hemisphere = new THREE.HemisphereLight(0xd8efff, 0x455448, 1.5);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xffe6c6, 2.4);
sun.position.set(-18, 30, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -22; sun.shadow.camera.right = 22;
sun.shadow.camera.top = 28; sun.shadow.camera.bottom = -22;
sun.shadow.bias = -0.0004;
scene.add(sun);

const clock = new THREE.Clock();
const roadSegments = [];
const scenery = [];
const traffic = [];
const particles = [];
const lanes = [-4.15, 0, 4.15];
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
let cameraShake = 0;
let audioContext;
let engineOscillator;
let engineGain;
let soundFilter;
let driftSoundTimer = 0;

const mat = (color, roughness = 0.65, metalness = 0.05, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

function makeAsphaltTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#303943'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4200; i++) {
    const shade = 45 + Math.random() * 40;
    ctx.fillStyle = `rgba(${shade},${shade + 3},${shade + 7},${Math.random() * 0.18})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1);
  }
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 3);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const asphalt = makeAsphaltTexture();
const roadMaterial = new THREE.MeshStandardMaterial({ map: asphalt, color: 0xffffff, roughness: 0.94, metalness: 0.02 });
const lineMaterial = mat(0xe4e1d3, 0.82, 0, { emissive: 0x100f09 });
const shoulderMaterial = mat(0x8c9290, 0.9);
const grassMaterial = mat(0x59745d, 1);

function addRoadSegment(z) {
  const group = new THREE.Group();
  const road = new THREE.Mesh(new THREE.BoxGeometry(14, 0.22, 50), roadMaterial);
  road.position.y = -0.02; road.receiveShadow = true; group.add(road);
  for (const x of [-7.15, 7.15]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 50), lineMaterial);
    edge.position.set(x, 0.105, 0); group.add(edge);
  }
  for (const x of [-2.32, 2.32]) {
    for (let dz = -22; dz < 25; dz += 10) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.035, 4.7), lineMaterial);
      dash.position.set(x, 0.105, dz); group.add(dash);
    }
  }
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 50), shoulderMaterial);
    shoulder.position.set(side * 8.5, -0.06, 0); shoulder.receiveShadow = true; group.add(shoulder);
  }
  group.position.z = z; scene.add(group); roadSegments.push(group);
}

function createCar(color, isPlayer = false, style = 0) {
  const car = new THREE.Group();
  const paint = mat(color, 0.27, 0.58, { clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const glass = mat(0x172b37, 0.18, 0.35, { transparent: true, opacity: 0.88, metalness: 0.2 });
  const rubber = mat(0x111417, 0.92, 0.02);
  const rim = mat(0xa6b2b4, 0.25, 0.8);
  const bodyWidth = style === 1 ? 2.18 : 1.95;
  const bodyLength = style === 1 ? 4.8 : 4.2;
  const body = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth, 0.72, bodyLength), paint);
  body.position.y = 0.68; body.castShadow = true; body.receiveShadow = true; car.add(body);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.92, 0.18, 1.12), paint);
  hood.position.set(0, 1.05, 1.3); hood.castShadow = true; car.add(hood);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.76, 0.68, 1.95), paint);
  cabin.position.set(0, 1.22, -0.32); cabin.castShadow = true; car.add(cabin);
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.7, 0.5, 0.08), glass);
  windshield.position.set(0, 1.3, 0.68); windshield.rotation.x = -0.18; car.add(windshield);
  const rearWindow = windshield.clone(); rearWindow.position.z = -1.25; rearWindow.rotation.x = 0.18; car.add(rearWindow);
  for (const side of [-1, 1]) {
    const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.38, 1.13), glass);
    windowMesh.position.set(side * bodyWidth * 0.39, 1.28, -0.3); car.add(windowMesh);
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.16, 0.1), mat(0xfaf2d8, 0.25, 0.15, { emissive: 0xffe7b0, emissiveIntensity: 0.35 }));
    headlight.position.set(side * 0.55, 0.78, bodyLength / 2 + 0.025); car.add(headlight);
    const rearLamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.08), mat(0xd2231a, 0.3, 0.1, { emissive: 0x5c0805 }));
    rearLamp.position.set(side * 0.55, 0.78, -bodyLength / 2 - 0.02); car.add(rearLamp);
    const wheel = new THREE.Group(); wheel.position.set(side * (bodyWidth / 2 + 0.02), 0.38, 1.25);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.27, 20), rubber); tire.rotation.z = Math.PI / 2; tire.castShadow = true; wheel.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.285, 16), rim); hub.rotation.z = Math.PI / 2; wheel.add(hub);
    car.add(wheel);
    const rearWheel = wheel.clone(); rearWheel.position.z = -1.35; car.add(rearWheel);
  }
  const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.94, 0.2, 0.22), mat(0x20272a, 0.45, 0.3));
  frontBumper.position.set(0, 0.37, bodyLength / 2); car.add(frontBumper);
  const rearBumper = frontBumper.clone(); rearBumper.position.z = -bodyLength / 2; car.add(rearBumper);
  if (isPlayer) {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.11, 0.25), mat(0x101820, 0.38, 0.5));
    spoiler.position.set(0, 1.05, -2.02); car.add(spoiler);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.035, 2.7), new THREE.MeshBasicMaterial({ color: 0x36bfff, transparent: true, opacity: 0.38 }));
    glow.position.y = 0.19; car.add(glow);
  }
  car.userData.body = body;
  return car;
}

function createPlayer() {
  player = createCar(0x1678c8, true);
  player.position.set(0, 0, 7); scene.add(player);
  const beam = new THREE.SpotLight(0xe5f5ff, 0, 55, Math.PI / 7, 0.55, 1.5);
  beam.position.set(0, 1.5, 2.1); beam.target.position.set(0, 0, -32);
  player.add(beam, beam.target); player.userData.headlamp = beam;
}

function createScenery() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 280), grassMaterial);
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.2, -60); ground.receiveShadow = true; scene.add(ground);
  for (let z = -190; z < 40; z += 18) {
    for (const side of [-1, 1]) {
      const group = new THREE.Group();
      const x = side * (11.4 + Math.random() * 2.4);
      if (Math.random() < 0.53) {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.22, 1.6, 8), mat(0x604732, 1));
        trunk.position.y = 0.8; trunk.castShadow = true; group.add(trunk);
        const crown = new THREE.Mesh(new THREE.ConeGeometry(1.05, 2.8, 9), mat(Math.random() < 0.5 ? 0x38694a : 0x4c7950, 1));
        crown.position.y = 2.45; crown.castShadow = true; group.add(crown);
      } else {
        const h = 3 + Math.random() * 7;
        const building = new THREE.Mesh(new THREE.BoxGeometry(2.6 + Math.random() * 2, h, 3 + Math.random() * 3), mat(0x59666c, 0.9));
        building.position.y = h / 2 - 0.1; building.castShadow = true; group.add(building);
        for (let wy = 0; wy < 3; wy++) {
          const window = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.48), mat(0xb8c9c4, 0.4, 0.05, { emissive: 0x31403a }));
          window.position.set(-0.7, 0.8 + wy * 0.75, 1.53); group.add(window);
        }
      }
      group.position.set(x, 0, z + Math.random() * 9); scene.add(group); scenery.push(group);
    }
    if (z % 36 === 0) {
      for (const side of [-1, 1]) {
        const poleGroup = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.08, 5.2, 8), mat(0x343e43, 0.5, 0.55));
        pole.position.set(side * 10, 2.6, 0); pole.castShadow = true; poleGroup.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.08), mat(0x343e43, 0.5, 0.55));
        arm.position.set(side * 9.35, 5.1, 0); poleGroup.add(arm);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.32), mat(0xffe8b3, 0.25, 0.1, { emissive: 0xffca70, emissiveIntensity: 0.3 }));
        lamp.position.set(side * 8.7, 5, 0); poleGroup.add(lamp);
        const light = new THREE.PointLight(0xffd69a, 0, 17, 2); light.position.set(side * 8.6, 4.7, 0); poleGroup.add(light);
        poleGroup.position.z = z; scene.add(poleGroup); scenery.push(poleGroup);
      }
    }
  }
  for (let i = 0; i < 8; i++) addRoadSegment(-i * 50);
}

function spawnTraffic() {
  const lane = lanes[Math.floor(Math.random() * lanes.length)];
  const colors = [0xe8e5dc, 0xb84238, 0x334f66, 0x8b9b92, 0xc59b4e, 0x252a32];
  const car = createCar(colors[Math.floor(Math.random() * colors.length)], false, Math.random() < 0.2 ? 1 : 0);
  car.position.set(lane, 0, -72 - Math.random() * 24);
  if (night) car.userData.headlightGlow = new THREE.PointLight(0xffe8c1, 0.8, 13, 2);
  scene.add(car);
  traffic.push({ mesh: car, lane, passed: false, relativeSpeed: 26 + Math.random() * 18 });
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
  engineOscillator = audioContext.createOscillator(); engineOscillator.type = 'sawtooth';
  soundFilter = audioContext.createBiquadFilter(); soundFilter.type = 'lowpass'; soundFilter.frequency.value = 230;
  engineGain = audioContext.createGain(); engineGain.gain.value = 0;
  engineOscillator.connect(soundFilter).connect(engineGain).connect(audioContext.destination); engineOscillator.start();
}
function oneShot(freq, duration, type = 'sine', volume = 0.08) {
  if (!soundEnabled) return;
  initAudio(); if (!audioContext) return;
  const osc = audioContext.createOscillator(); const gain = audioContext.createGain();
  osc.type = type; osc.frequency.setValueAtTime(freq, audioContext.currentTime);
  gain.gain.setValueAtTime(volume, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
  osc.connect(gain).connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + duration);
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
  scene.background.copy(color); scene.fog.color.copy(color);
  hemisphere.intensity = night ? 0.43 : 1.5;
  sun.intensity = night ? 0.12 : 2.4;
  sun.color.set(night ? 0x9ab8ff : 0xffe6c6);
  if (player?.userData.headlamp) player.userData.headlamp.intensity = night ? 2.8 : 0;
  $('night-button').textContent = night ? '☾' : '☼';
  for (const group of scenery) group.traverse((object) => {
    if (object.isPointLight) object.intensity = night ? 1.4 : 0;
  });
  for (const item of traffic) {
    if (night && !item.mesh.userData.headlightGlow) {
      const glow = new THREE.PointLight(0xffe4b7, 0.55, 11, 2); glow.position.set(0, 0.8, 2.8); item.mesh.add(glow); item.mesh.userData.headlightGlow = glow;
    } else if (item.mesh.userData.headlightGlow) item.mesh.userData.headlightGlow.intensity = night ? 0.55 : 0;
  }
}

function addSparks(position, amount = 24) {
  const colors = [0xffd27a, 0xff783d, 0xe9f7ff];
  for (let i = 0; i < amount; i++) {
    const particle = new THREE.Mesh(new THREE.SphereGeometry(0.045 + Math.random() * 0.05, 5, 5), new THREE.MeshBasicMaterial({ color: colors[i % colors.length] }));
    particle.position.copy(position); scene.add(particle);
    particles.push({ mesh: particle, velocity: new THREE.Vector3((Math.random() - 0.5) * 13, Math.random() * 8, (Math.random() - 0.5) * 13), life: 0.35 + Math.random() * 0.55 });
  }
}

function resetGame() {
  score = 0; speed = 105; nitro = 100; steerVelocity = 0; spawnTimer = 1.2;
  running = true; nitroActive = false; cameraShake = 0;
  player.position.set(0, 0, 7); player.rotation.set(0, 0, 0);
  clearTraffic();
  for (const p of particles) scene.remove(p.mesh); particles.length = 0;
  scoreEl.textContent = '0'; speedEl.textContent = '105'; nitroFill.style.width = '100%';
  startOverlay.classList.add('hidden'); gameOverOverlay.classList.add('hidden');
  if (soundEnabled) { initAudio(); if (audioContext?.state === 'suspended') audioContext.resume(); }
}

function gameOver() {
  if (!running) return;
  running = false; nitroActive = false; cameraShake = 0.8;
  addSparks(player.position.clone().add(new THREE.Vector3(0, 0.7, 0)), 42);
  oneShot(90, 0.65, 'sawtooth', 0.16);
  crashFlash.style.transition = 'none'; crashFlash.style.opacity = '0.75';
  requestAnimationFrame(() => { crashFlash.style.transition = 'opacity .55s'; crashFlash.style.opacity = '0'; });
  finalScoreEl.innerHTML = `${Math.floor(score)} <small>METERS</small>`;
  setTimeout(() => gameOverOverlay.classList.remove('hidden'), 500);
}

function updateRoad(delta) {
  const movement = (speed / 3.6) * delta;
  for (const segment of roadSegments) {
    segment.position.z += movement;
    if (segment.position.z > 50) segment.position.z -= roadSegments.length * 50;
  }
  for (const prop of scenery) {
    prop.position.z += movement;
    if (prop.position.z > 30) prop.position.z -= 225;
  }
  asphalt.offset.y -= movement * 0.018;
}

function updatePlayer(delta) {
  const input = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const drifting = keys.drift && Math.abs(input) > 0;
  const grip = drifting ? 0.56 : 1;
  const targetVelocity = input * (drifting ? 10.5 : 8.3);
  steerVelocity = THREE.MathUtils.damp(steerVelocity, targetVelocity, drifting ? 4 : 8, delta);
  player.position.x = THREE.MathUtils.clamp(player.position.x + steerVelocity * delta, -5.15, 5.15);
  player.rotation.z = THREE.MathUtils.damp(player.rotation.z, -steerVelocity * 0.025 * grip, 8, delta);
  player.rotation.y = THREE.MathUtils.damp(player.rotation.y, -input * (drifting ? 0.11 : 0.045), 7, delta);
  player.userData.body.position.y = 0.68 + Math.sin(performance.now() * 0.009) * 0.012;
  if (drifting && Math.abs(input) > 0 && Math.random() < delta * 16) {
    const side = Math.sign(input);
    addSparks(player.position.clone().add(new THREE.Vector3(-side * 1, 0.2, -1.5)), 1);
    score += delta * 8;
    driftSoundTimer -= delta;
    if (driftSoundTimer <= 0) { oneShot(240 + Math.random() * 90, 0.13, 'triangle', 0.018); driftSoundTimer = 0.2; }
  }
  if (Math.abs(player.position.x) > 4.85) speed = Math.max(75, speed - delta * 38);
}

function updateTraffic(delta) {
  spawnTimer -= delta;
  if (spawnTimer <= 0 && traffic.length < 7) {
    spawnTraffic(); spawnTimer = Math.max(0.62, 1.25 - speed / 520) + Math.random() * 0.5;
  }
  for (let i = traffic.length - 1; i >= 0; i--) {
    const item = traffic[i];
    item.mesh.position.z += ((speed / 3.6) + item.relativeSpeed) * delta;
    item.mesh.position.x = THREE.MathUtils.damp(item.mesh.position.x, item.lane, 3, delta);
    if (item.mesh.position.z > 24) {
      scene.remove(item.mesh); traffic.splice(i, 1);
      if (!item.passed) score += 12;
      continue;
    }
    const dx = Math.abs(player.position.x - item.mesh.position.x);
    const dz = Math.abs(player.position.z - item.mesh.position.z);
    if (dx < 1.62 && dz < 3.15) { gameOver(); return; }
  }
}

function updateParticles(delta) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.life -= delta;
    p.velocity.y -= 12 * delta; p.mesh.position.addScaledVector(p.velocity, delta);
    if (p.life <= 0) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); particles.splice(i, 1); }
  }
}

function update(delta) {
  updateParticles(delta);
  if (!running) {
    cameraShake = Math.max(0, cameraShake - delta * 2.2);
    return;
  }
  const boosting = keys.nitro && nitro > 0;
  nitroActive = boosting;
  if (boosting) { nitro = Math.max(0, nitro - delta * 34); speed = THREE.MathUtils.damp(speed, 235, 2.4, delta); }
  else { nitro = Math.min(100, nitro + delta * 9); speed = THREE.MathUtils.damp(speed, 145, 0.2, delta); }
  if (boosting && Math.random() < delta * 18) addSparks(player.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.3, -2.6)), 1);
  updateRoad(delta); updatePlayer(delta); updateTraffic(delta);
  score += delta * speed / 3.6 * 1.5;
  scoreEl.textContent = Math.floor(score).toLocaleString();
  speedEl.textContent = Math.round(speed).toString();
  nitroFill.style.width = `${nitro}%`;
  nitroLabel.textContent = nitroActive ? 'BOOST' : nitro > 99 ? 'READY' : 'CHARGING';
  camera.position.x = THREE.MathUtils.damp(camera.position.x, player.position.x * 0.32, 2.6, delta);
  camera.position.y = THREE.MathUtils.damp(camera.position.y, nitroActive ? 6.0 : 6.2, 2, delta);
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
  const delta = Math.min(clock.getDelta(), 0.04);
  update(delta);
  renderer.render(scene, camera);
}

function setControl(name, value) { keys[name] = value; }
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['arrowleft', 'arrowright', ' ', 'shift'].includes(key) || ['arrowleft', 'arrowright'].includes(event.key)) event.preventDefault();
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
  button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
});
$('start-button').addEventListener('click', resetGame);
$('restart-button').addEventListener('click', resetGame);
$('night-button').addEventListener('click', () => setNight(!night));
$('sound-button').addEventListener('click', () => {
  soundEnabled = !soundEnabled; $('sound-button').textContent = soundEnabled ? '♫' : '♪';
  if (!soundEnabled && audioContext) engineGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.05);
  if (soundEnabled && running) initAudio();
});

for (let i = 0; i < 8; i++) addRoadSegment(-i * 50);
createScenery();
createPlayer();
setNight(false);
resize(); window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
animate();
