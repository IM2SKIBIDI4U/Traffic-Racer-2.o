import * as THREE from 'three';

// Camera presets are applied at render time so they work alongside the game's
// own follow-camera update without coupling this feature to gameplay internals.
const modes = [
  { id: 'chase', label: 'CHASE', position: new THREE.Vector3(0, 4.2, 9.5), target: new THREE.Vector3(0, 1, -13), fov: 66 },
  { id: 'hood', label: 'HOOD', position: new THREE.Vector3(0, 1.35, 1.15), target: new THREE.Vector3(0, 1.25, -36), fov: 73 },
  { id: 'cockpit', label: 'COCKPIT', position: new THREE.Vector3(0, 1.05, -0.35), target: new THREE.Vector3(0, 1.0, -38), fov: 76 },
  { id: 'overhead', label: 'OVERHEAD', position: new THREE.Vector3(0, 13, 7), target: new THREE.Vector3(0, 0, -8), fov: 62 },
];
let selected = 0;
try {
  const saved = localStorage.getItem('tr-camera-mode');
  const index = modes.findIndex((mode) => mode.id === saved);
  if (index >= 0) selected = index;
} catch { /* Storage is optional. */ }

function cycleMode() {
  selected = (selected + 1) % modes.length;
  try { localStorage.setItem('tr-camera-mode', modes[selected].id); } catch { /* Storage is optional. */ }
  const button = document.getElementById('camera-mode-button');
  if (button) { button.textContent = `CAM: ${modes[selected].label} · C`; button.setAttribute('aria-label', `Camera mode: ${modes[selected].label}. Press C to change.`); }
}

function install() {
  const button = document.createElement('button');
  button.id = 'camera-mode-button';
  button.type = 'button';
  button.className = 'glass';
  button.textContent = `CAM: ${modes[selected].label} · C`;
  button.setAttribute('aria-label', `Camera mode: ${modes[selected].label}. Press C to change.`);
  Object.assign(button.style, { position: 'absolute', top: '86px', right: '22px', zIndex: '2', padding: '9px 12px', borderRadius: '20px', color: '#75e4ef', font: '700 10px "DM Sans", sans-serif', letterSpacing: '.08em', cursor: 'pointer', pointerEvents: 'auto' });
  document.getElementById('hud')?.append(button);
  button.addEventListener('click', cycleMode);
  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'c' && !event.repeat && !event.target.matches('input, textarea, select')) cycleMode();
  });

  const originalRender = THREE.WebGLRenderer.prototype.render;
  THREE.WebGLRenderer.prototype.render = function(scene, camera) {
    let car = null;
    scene.traverse((object) => { if (!car && object.userData?.headlamp) car = object; });
    if (car) {
      const mode = modes[selected];
      const desiredPosition = car.localToWorld(mode.position.clone());
      const desiredTarget = car.localToWorld(mode.target.clone());
      camera.position.lerp(desiredPosition, 0.32);
      camera.fov += (mode.fov - camera.fov) * 0.18;
      if (mode.id === 'overhead') camera.up.set(0, 0, -1);
      else camera.up.set(0, 1, 0);
      camera.lookAt(desiredTarget);
      camera.updateProjectionMatrix();
    }
    return originalRender.call(this, scene, camera);
  };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
