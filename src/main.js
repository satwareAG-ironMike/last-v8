// App shell: WebGLRenderer, test-cell environment, lights, block casting,
// cranktrain, DOHC valvetrain, the two cylinder heads, the intake / exhaust
// manifolds and the industrial test stand that carries the engine. UI and
// camera rigs land in the following commit; everything visual here is
// procedural (see src/render/materials.js).
import * as THREE from 'three';
import { createEnvironment, createMaterials } from './render/materials.js';
import { createBlock } from './render/block.js';
import { createCranktrain } from './render/cranktrain.js';
import { createValvetrain } from './render/valvetrain.js';
import { createHeads } from './render/heads.js';
import { createManifolds } from './render/manifolds.js';
import { createStand } from './render/stand.js';
import { createEngineState } from './engine/animation.js';
import { createCameraRig } from './ui/cameraRig.js';
import { SPEC, bankOut, bankUp } from './engine/spec.js';

const container = document.getElementById('viewport');
const statusEl = document.getElementById('status');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in r187
renderer.localClippingEnabled = true;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);
scene.fog = new THREE.Fog(0x0e1116, 260, 900);
scene.environment = createEnvironment(renderer);

const materials = createMaterials();

// test-cell lighting: warm key with hard shadows, cool fill, warm rim from the front
const key = new THREE.DirectionalLight(0xfff1de, 3.2);
key.position.set(60, 95, 70);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
const EXTENT = 160;
key.shadow.camera.left = -EXTENT;
key.shadow.camera.right = EXTENT;
key.shadow.camera.top = EXTENT;
key.shadow.camera.bottom = -EXTENT;
key.shadow.camera.near = 10;
key.shadow.camera.far = 420;
key.shadow.bias = -0.0008;
scene.add(key);

const fill = new THREE.DirectionalLight(0x9fb6d4, 0.9);
fill.position.set(-90, 45, -60);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffc27a, 1.3);
rim.position.set(-35, 20, 110);
scene.add(rim);

// floor is the XY plane at SPEC.stand.floorZ (world Z is up, see engine/spec.js);
// the stand's feet sit exactly on it
const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), materials.floorPlate);
floor.position.z = SPEC.stand.floorZ;
floor.receiveShadow = true;
scene.add(floor);

// The test stand is fixed cell hardware: it goes into the scene, never into the
// engine group, and it has no update() - the engine hangs from it.
const stand = createStand(materials);
scene.add(stand.group);

const engine = createBlock(materials);
engine.name = 'v8-block';
scene.add(engine);

// Rotating assembly lives in the same scene graph as the casting; the only
// animation clock is state.theta, posed through src/engine/timing.js math.
const state = createEngineState({ rpm: 1600, running: true });
const cranktrain = createCranktrain(materials);
engine.add(cranktrain.group);
const valvetrain = createValvetrain(materials);
engine.add(valvetrain.group);
const heads = createHeads(materials);
engine.add(heads.group);
const manifolds = createManifolds(materials);
engine.add(manifolds.group);

// The camera and its rig. The pose is NOT written here: SPEC.view carries the
// swept boot framing (engine, manifolds and the whole test stand uncropped in a
// 16:9 frame) and the rig reproduces it, so the framing exists exactly once.
const camera = new THREE.PerspectiveCamera(SPEC.view.fov, window.innerWidth / window.innerHeight, 0.5, 3000);
const rig = createCameraRig(camera);
rig.update(0); // land the camera on the published home pose before the first render

// --- input: mouse orbit, wheel zoom, WASD + QE walk, R = RESET CAMERA --------
// Every input is a GOAL for the rig; the loop chases it, which is what makes the
// motion smooth and frame-rate independent (src/ui/cameraRig.js).
const canvas = renderer.domElement;
const keys = new Set();
let dragging = false;
let lastPx = 0;
let lastPy = 0;

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastPx = e.clientX;
  lastPy = e.clientY;
  canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  rig.orbit(e.clientX - lastPx, e.clientY - lastPy);
  lastPx = e.clientX;
  lastPy = e.clientY;
});
const endDrag = () => {
  dragging = false;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', endDrag);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
  rig.zoom(THREE.MathUtils.clamp((e.deltaY * lines) / 100, -3, 3));
}, { passive: false });

// A control in the panel (the RPM slider, a button) keeps keyboard focus while
// it is in use: movement keys must not fire into the camera from a form field.
const formFocused = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
};
const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']);
window.addEventListener('keydown', (e) => {
  if (formFocused()) return;
  if (e.code === 'KeyR') {
    rig.reset();
    return;
  }
  if (!MOVE_CODES.has(e.code)) return;
  keys.add(e.code);
  e.preventDefault(); // the page must not scroll while walking
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

/** The walk vector from the held keys, in the rig's own floor-parallel basis. */
function readKeys() {
  const held = (c) => (keys.has(c) ? 1 : 0);
  return {
    fwd: held('KeyW') - held('KeyS'),
    strafe: held('KeyD') - held('KeyA'),
    rise: held('KeyQ') - held('KeyE'),
    boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  };
}

let lastT = performance.now();
let frameCount = 0;

function renderFrame() {
  renderer.render(scene, camera);
  frameCount += 1;
}

function loop() {
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  state.step(dt);
  cranktrain.update(state.theta);
  valvetrain.update(state.theta);
  const w = readKeys();
  if (w.fwd || w.strafe || w.rise) rig.walk(w, dt); // held keys walk every frame
  rig.update(dt); // writes the camera pose the renderer is about to use
  renderFrame();
  if (frameCount % 30 === 0) {
    statusEl.textContent = state.running
      ? `${state.rpm} rpm - crank ${state.theta.toFixed(0)}°${state.slowmo < 1 ? ` - slowmo ${state.slowmo}` : ''}`
      : `engine stopped - crank ${state.theta.toFixed(0)}°`;
  }
  requestAnimationFrame(loop);
}
loop();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/**
 * Renders one frame and reads back the drawing buffer: the non-blank proof
 * the headless gates assert on. Returns luminance stats over a sampled grid.
 */
function grabFrame() {
  renderer.render(scene, camera);
  frameCount += 1;
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let min = 255;
  let max = 0;
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 4 * 97) {
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    if (l < min) min = l;
    if (l > max) max = l;
    sum += l;
    sq += l * l;
    n += 1;
  }
  const mean = sum / n;
  return {
    frames: frameCount,
    width: w,
    height: h,
    samples: n,
    mean,
    min,
    max,
    contrast: max - min,
    stddev: Math.sqrt(Math.max(0, sq / n - mean * mean)),
    drawCalls: renderer.info.render.calls,
    webgl2: renderer.capabilities.isWebGL2,
  };
}

window.__v8 = {
  version: 'v8-0.9-camera',
  SPEC,
  bankOut,
  bankUp,
  THREE,
  renderer,
  scene,
  camera,
  rig,
  materials,
  engine,
  cranktrain,
  valvetrain,
  heads,
  manifolds,
  stand,
  state,
  start: () => state.start(),
  stop: () => state.stop(),
  setRpm: (v) => state.setRpm(v),
  setSlowmo: (f) => state.setSlowmo(f),
  orbitBy: (dx, dy) => rig.orbit(dx, dy),
  zoomBy: (notches) => rig.zoom(notches),
  walkBy: (o, dt) => rig.walk(o, dt),
  focusPart: (point, range) => rig.focusOn(point, range),
  resetCamera: () => rig.reset(),
  cameraPose: () => rig.state(),
  frameCount: () => frameCount,
  grabFrame,
};
