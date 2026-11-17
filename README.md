import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const canvas = document.getElementById('game-canvas');
const scoreEl = document.getElementById('score');
const speedEl = document.getElementById('speed');
const startOverlay = document.getElementById('start-overlay');
const gameOverOverlay = document.getElementById('game-over');
const finalScoreEl = document.getElementById('final-score');
const startButton = document.getElementById('start-button');
const restartButton = document.getElementById('restart-button');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9dc9ec);
scene.fog = new THREE.Fog(0x9dc9ec, 25, 160);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 500);
camera.position.set(0, 6.3, 12.5);
camera.lookAt(0, 1.5, -20);

const hemiLight = new THREE.HemisphereLight(0xdfeeff, 0x40515e, 1.5);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff2d6, 2.2);
sunLight.position.set(18, 26, 8);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(1024, 1024);
sunLight.shadow.camera.left = -30;
sunLight.shadow.camera.right = 30;
sunLight.shadow.camera.top = 30;
sunLight.shadow.camera.bottom = -30;
scene.add(sunLight);

const clock = new THREE.Clock();
const roadSegments = [];
const sideProps = [];
const trafficCars = [];
const laneX = [-7.5, 0, 7.5];

let score = 0;
let speed = 0;
let roadVelocity = 0;
let isRunning = false;
let lastTime = 0;
let spawnCooldown = 0;
let playerCar;
let roadGroup;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createRoadSegment(zPos) {
  const group = new THREE.Group();

  const shoulderMaterial = new THREE.MeshStandardMaterial({
    color: 0x2c3a48,
    roughness: 0.92,
    metalness: 0.06,
  });

  const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0x343c46,
    roughness: 0.86,
    metalness: 0.18,
  });

  const laneMaterial = new THREE.MeshStandardMaterial({
    color: 0xfef4d0,
    emissive: 0x3d2d00,
    roughness: 0.8,
  });

  const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 38), shoulderMaterial);
  shoulderL.position.set(-13.2, 0.05, 0);
  shoulderL.receiveShadow = true;

  const shoulderR = shoulderL.clone();
  shoulderR.position.x = 13.2;

  const road = new THREE.Mesh(new THREE.BoxGeometry(24, 0.2, 38), roadMaterial);
  road.position.y = 0.1;
  road.receiveShadow = true;

  const laneLineGeometry = new THREE.BoxGeometry(0.18, 0.03, 5.5);
  for (const x of [-7.5, 7.5]) {
    const line = new THREE.Mesh(laneLineGeometry, laneMaterial);
    line.position.set(x, 0.21, 0);
    group.add(line);
  }

  for (let i = -15; i <= 15; i += 6) {
    const dash = new THREE.Mesh(laneLineGeometry, laneMaterial);
    dash.position.set(0, 0.21, i);
    group.add(dash);
  }

  group.add(shoulderL, shoulderR, road);
  group.position.z = zPos;
  scene.add(group);
  roadSegments.push(group);
}

function createRoad() {
  for (let i = 0; i < 10; i += 1) {
    createRoadSegment(-i * 38);
  }
}

function createStreetLight(x, z) {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.18, 4.5, 10),
    new THREE.MeshStandardMaterial({ color: 0x46515d, metalness: 0.6, roughness: 0.5 })
  );
  pole.position.set(x, 2.2, z);
  pole.castShadow = true;

  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.2, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xfef3b6, emissive: 0x7a5d00, roughness: 0.7 })
  );
  lamp.position.set(x, 4.4, z + 0.6);

  const glow = new THREE.PointLight(0xffd47d, 1.8, 18, 2);
  glow.position.set(x, 4.1, z + 0.5);

  const group = new THREE.Group();
  group.add(pole, lamp, glow);
  group.position.z = z;
  scene.add(group);
  sideProps.push(group);
}

function createTree(x, z) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.28, 1.1, 8),
    new THREE.MeshStandardMaterial({ color: 0x5b3d2c, roughness: 1 })
  );
  trunk.position.set(x, 0.55, z);

  const crown = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x2b8d5a, roughness: 0.9 })
  );
  crown.position.set(x, 1.8, z);
  crown.scale.set(1.2, 1.4, 1.2);

  const group = new THREE.Group();
  group.add(trunk, crown);
  group.position.z = z;
  scene.add(group);
  sideProps.push(group);
}

function addEnvironment() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 260),
    new THREE.MeshStandardMaterial({ color: 0x7ea784, roughness: 0.98 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.15;
  ground.receiveShadow = true;
  scene.add(ground);

  for (let z = -160; z <= 100; z += 26) {
    createTree(-18, z);
    createTree(18, z + 10);
    createStreetLight(-23, z + 6);
    createStreetLight(23, z + 4);
  }
}

function createWheel(x, y, z) {
  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.34, 18),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.2 })
  );
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(x, y, z);
  return wheel;
}

function createCar(color = 0xff5d5d, isTraffic = false) {
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.4,
    roughness: 0.35,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 4.6), bodyMaterial);
  body.position.y = 0.75;
  body.castShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.7, 2.1),
    new THREE.MeshStandardMaterial({ color: 0xcfe6ff, metalness: 0.35, roughness: 0.22, transparent: true, opacity: 0.8 })
  );
  cabin.position.set(0, 1.35, -0.3);
  cabin.castShadow = true;
  group.add(cabin);

  const frontLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.18, 0.16),
    new THREE.MeshStandardMaterial({ color: 0xfbf3d5, emissive: 0xd8aa1c, roughness: 0.4 })
  );
  frontLight.position.set(0, 0.98, 2.4);
  group.add(frontLight);

  const rearLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.18, 0.16),
    new THREE.MeshStandardMaterial({ color: 0xff6e6e, emissive: 0x7a0404, roughness: 0.4 })
  );
  rearLight.position.set(0, 0.98, -2.4);
  group.add(rearLight);

  const wheelPositions = [
    [-1.15, 0.35, 1.4],
    [1.15, 0.35, 1.4],
    [-1.15, 0.35, -1.4],
    [1.15, 0.35, -1.4],
  ];

  for (const [x, y, z] of wheelPositions) {
    const wheel = createWheel(x, y, z);
    group.add(wheel);
  }

  if (!isTraffic) {
    const underGlow = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.04, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x59d5ff, emissive: 0x2db4ff, transparent: true, opacity: 0.7 })
    );
    underGlow.position.set(0, 0.08, 0);
    group.add(underGlow);
  }

  return group;
}

function createPlayerCar() {
  playerCar = createCar(0x2aa4ff, false);
  playerCar.position.set(0, 0.1, 7.6);
  scene.add(playerCar);
}

function spawnTrafficCar() {
  const lane = laneX[Math.floor(Math.random() * laneX.length)];
  const color = new THREE.Color().setHSL(Math.random() * 0.18 + 0.02, 0.7, 0.52).getHex();
  const car = createCar(color, true);
  car.position.set(lane, 0.1, -42 - Math.random() * 45);
  car.rotation.y = Math.PI;
  scene.add(car);
  trafficCars.push(car);
}

function resetGame() {
  score = 0;
  speed = 55;
  roadVelocity = speed * 0.12;
  spawnCooldown = 1.1;
  isRunning = true;
  lastTime = 0;

  if (playerCar) {
    playerCar.position.x = 0;
    playerCar.position.z = 7.6;
  }

  for (const car of trafficCars) {
    scene.remove(car);
  }
  trafficCars.length = 0;

  scoreEl.textContent = '0';
  speedEl.textContent = '0';
  gameOverOverlay.classList.add('hidden');
  startOverlay.classList.remove('visible');
  startOverlay.classList.add('hidden');
}

function endGame() {
  isRunning = false;
  finalScoreEl.textContent = `Final Score: ${Math.floor(score)}`;
  gameOverOverlay.classList.remove('hidden');
}

function updateRoads(delta) {
  for (const segment of roadSegments) {
    segment.position.z += speed * delta * 0.7;
    if (segment.position.z > 44) {
      segment.position.z -= roadSegments.length * 38;
    }
  }

  for (const prop of sideProps) {
    prop.position.z += speed * delta * 0.8;
    if (prop.position.z > 34) {
      prop.position.z -= 180;
    }
  }
}

function updateTraffic(delta) {
  spawnCooldown -= delta;
  if (spawnCooldown <= 0 && isRunning) {
    spawnTrafficCar();
    spawnCooldown = Math.max(0.7, 1.9 - speed / 56);
  }

  for (let i = trafficCars.length - 1; i >= 0; i -= 1) {
    const car = trafficCars[i];
    car.position.z += (speed * 0.95 + 16) * delta;

    if (car.position.z > 20) {
      scene.remove(car);
      trafficCars.splice(i, 1);
      score += 8;
      continue;
    }

    const dx = playerCar.position.x - car.position.x;
    const dz = playerCar.position.z - car.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 2.3) {
      endGame();
      return;
    }
  }
}

function updatePlayer(delta) {
  const moveAmount = 16 * delta;
  const left = keys.left ? -1 : 0;
  const right = keys.right ? 1 : 0;
  const steer = left + right;
  playerCar.position.x += steer * moveAmount * (1 + speed / 85);
  playerCar.position.x = clamp(playerCar.position.x, -9.5, 9.5);

  playerCar.rotation.z = THREE.MathUtils.lerp(playerCar.rotation.z, steer * -0.18, 0.12);
  playerCar.rotation.x = THREE.MathUtils.lerp(playerCar.rotation.x, -steer * 0.05, 0.12);
}

const keys = {
  left: false,
  right: false,
};

window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
    keys.left = true;
  }
  if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
    keys.right = true;
  }
});

window.addEventListener('keyup', (event) => {
  if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
    keys.left = false;
  }
  if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
    keys.right = false;
  }
});

function resizeRenderer() {
  const { clientWidth, clientHeight } = canvas;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resizeRenderer);

function animate() {
  const delta = Math.min(clock.getDelta(), 0.032);

  if (isRunning) {
    speed = THREE.MathUtils.clamp(speed + delta * 15, 40, 180);
    score += delta * speed * 0.7;
    scoreEl.textContent = `${Math.floor(score)}`;
    speedEl.textContent = `${Math.floor(speed * 1.7)}`;

    updateRoads(delta);
    updatePlayer(delta);
    updateTraffic(delta);

    camera.position.x = THREE.MathUtils.lerp(camera.position.x, playerCar.position.x * 0.6, 0.08);
    camera.lookAt(playerCar.position.x * 0.6, 1.7, -20);
  } else {
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, 0, 0.08);
    camera.lookAt(0, 1.4, -25);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function startGame() {
  resetGame();
}

startButton.addEventListener('click', startGame);
restartButton.addEventListener('click', startGame);

createRoad();
addEnvironment();
createPlayerCar();
resizeRenderer();
requestAnimationFrame(animate);
