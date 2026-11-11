// App shell: WebGLRenderer, test-cell environment, lights, block casting,
// cranktrain and DOHC valvetrain. Manifolds, stand, UI and camera rigs land
// in the following commits; everything visual here is procedural
// (see src/render/materials.js).
import * as THREE from 'three';
import { createEnvironment, createMaterials } from './render/materials.js';
import { createBlock } from './render/block.js';
import { createCranktrain } from './render/cranktrain.js';
import { createValvetrain } from './render/valvetrain.js';
import { createEngineState } from './engine/animation.js';

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

// floor is the XY plane at z = -16.5 (world Z is up, see engine/spec.js)
const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), materials.floorPlate);
floor.position.z = -16.5;
floor.receiveShadow = true;
scene.add(floor);

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

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.5, 3000);
camera.up.set(0, 0, 1); // world is Z-up (see src/engine/spec.js); keep the deck vertical in frame
camera.position.set(84.4, -117.6, 104.5);
camera.lookAt(-3.3, -0.4, 16); // swept numerically: whole engine uncropped AND max valvetrain parts on screen

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
  version: 'v8-0.5-valvetrain',
  THREE,
  renderer,
  scene,
  camera,
  materials,
  engine,
  cranktrain,
  valvetrain,
  state,
  start: () => state.start(),
  stop: () => state.stop(),
  setRpm: (v) => state.setRpm(v),
  setSlowmo: (f) => state.setSlowmo(f),
  frameCount: () => frameCount,
  grabFrame,
};
