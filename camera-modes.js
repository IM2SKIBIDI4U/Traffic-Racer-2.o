import * as THREE from 'three';

const modes = [
  // Local +Z is forward in city mode; highway mode uses local -Z.
  { id: 'chase', label: 'CHASE', position: new THREE.Vector3(0, 4.0, -8.2), target: new THREE.Vector3(0, 1.1, 13), fov: 66 },
  { id: 'hood', label: 'HOOD', position: new THREE.Vector3(0, 1.55, 1.25), target: new THREE.Vector3(0, 1.35, 42), fov: 73 },
  { id: 'cockpit', label: 'COCKPIT', position: new THREE.Vector3(0, 1.18, 0.35), target: new THREE.Vector3(0, 1.05, 42), fov: 76 },
  { id: 'overhead', label: 'OVERHEAD', position: new THREE.Vector3(0, 11, -5), target: new THREE.Vector3(0, 0, 8), fov: 62 },
];
let selected = 0;
try {
  const saved = localStorage.getItem('tr-camera-mode');
  const index = modes.findIndex((mode) => mode.id === saved);
  if (index >= 0) selected = index;
} catch { /* Storage is optional. */ }

function updateButton() {
  const button = document.getElementById('camera-mode-button');
  if (button) {
    button.textContent = `CAM: ${modes[selected].label} · C`;
    button.setAttribute('aria-label', `Camera mode: ${modes[selected].label}. Press C to change.`);
  }
}

function cycleMode() {
  selected = (selected + 1) % modes.length;
  try { localStorage.setItem('tr-camera-mode', modes[selected].id); } catch { /* Storage is optional. */ }
  updateButton();
}

export function applyCameraMode(camera, player, dt = 0, forwardSign = -1) {
  if (!player) return;
  const mode = modes[selected];
  // The city drives toward local +Z; the original highway drives toward -Z.
  // Mirror only the local Z offsets so every preset works in both modes.
  const positionOffset = mode.position.clone();
  const targetOffset = mode.target.clone();
  positionOffset.z *= forwardSign;
  targetOffset.z *= forwardSign;
  const desiredPosition = player.localToWorld(positionOffset);
  const desiredTarget = player.localToWorld(targetOffset);
  const blend = dt > 0 ? 1 - Math.exp(-8 * dt) : 1;
  camera.position.lerp(desiredPosition, blend);
  camera.fov += (mode.fov - camera.fov) * (dt > 0 ? 1 - Math.exp(-5 * dt) : 1);
  camera.up.set(0, 0, mode.id === 'overhead' ? -forwardSign : 0);
  if (mode.id !== 'overhead') camera.up.set(0, 1, 0);
  camera.lookAt(desiredTarget);
  camera.updateProjectionMatrix();
}

function install() {
  if (document.getElementById('camera-mode-button')) return;
  const button = document.createElement('button');
  button.id = 'camera-mode-button';
  button.type = 'button';
  button.className = 'glass';
  button.textContent = `CAM: ${modes[selected].label} · C`;
  button.setAttribute('aria-label', `Camera mode: ${modes[selected].label}. Press C to change.`);
  Object.assign(button.style, {
    position: 'absolute', top: '86px', right: '22px', zIndex: '2',
    padding: '9px 12px', borderRadius: '20px', color: '#75e4ef',
    font: '700 10px "DM Sans", sans-serif', letterSpacing: '.08em',
    cursor: 'pointer', pointerEvents: 'auto'
  });
  document.getElementById('hud')?.append(button);
  button.addEventListener('click', cycleMode);
  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'c' && !event.repeat &&
        !event.target.matches('input, textarea, select, button')) cycleMode();
  });
  updateButton();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
