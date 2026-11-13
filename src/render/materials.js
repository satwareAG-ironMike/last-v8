// Procedural PBR materials and environment. All maps are generated in-canvas:
// no image assets are downloaded or shipped with this project.
import * as THREE from 'three';
import { PMREMGenerator } from 'three';
import { SPEC } from '../engine/spec.js';

// ---- seeded noise --------------------------------------------------------

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664456904 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function lattice(size, seed) {
  const rnd = lcg(seed);
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return g;
}

function sampleLattice(g, size, x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const smooth = (t) => t * t * (3 - 2 * t);
  const u = smooth(xf);
  const v = smooth(yf);
  const i0 = ((yi % size) + size) % size;
  const i1 = (i0 + 1) % size;
  const j0 = ((xi % size) + size) % size;
  const j1 = (j0 + 1) % size;
  const a = g[i0 * size + j0];
  const b = g[i0 * size + j1];
  const c = g[i1 * size + j0];
  const d = g[i1 * size + j1];
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/** Multi-octave value noise as a greyscale canvas. */
export function noiseCanvas(size, { seed = 7, octaves = 5, baseCells = 6, contrast = 0.5, gain = 0.55, stretch = 1 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const grids = [];
  let cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    grids.push({ g: lattice(cells, seed + o * 977), cells });
    cells *= 2;
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 1;
      let norm = 0;
      for (const layer of grids) {
        const fx = (x / size) * layer.cells;
        const fy = (y / size) * layer.cells * stretch;
        v += sampleLattice(layer.g, layer.cells, fx, fy) * amp;
        norm += amp;
        amp *= gain;
      }
      v = v / norm;
      v = 0.5 + (v - 0.5) * (1 + contrast);
      const c = Math.max(0, Math.min(255, Math.round(v * 255)));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Sobel height -> tangent-space normal map. */
export function normalCanvasFromHeight(height, strength = 1.4) {
  const size = height.width;
  const src = height.getContext('2d').getImageData(0, 0, size, size).data;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => {
    const xi = ((x % size) + size) % size;
    const yi = ((y % size) + size) % size;
    return src[(yi * size + xi) * 4] / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = -dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      img.data[i] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Directional machining / brushed streaks. */
export function brushedCanvas(size, { seed = 21, streaks = 900, contrast = 0.35 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  const rnd = lcg(seed);
  for (let i = 0; i < streaks; i++) {
    const y = rnd() * size;
    const len = size * (0.25 + rnd() * 0.8);
    const x = rnd() * size;
    const a = 0.02 + rnd() * 0.1;
    ctx.strokeStyle = rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.lineWidth = 0.5 + rnd() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (rnd() - 0.5) * 2);
    ctx.stroke();
  }
  void contrast;
  return cv;
}

export function hazardCanvas(size = 512, { angle = Math.PI / 4, band = 0.09 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#e8b12a';
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(angle);
  ctx.fillStyle = '#1b1d20';
  const n = Math.ceil(size / (band * size)) + 2;
  for (let i = -n; i < n; i++) {
    ctx.fillRect(-size, i * band * size, size * 2, band * size * 0.72);
  }
  ctx.restore();
  return cv;
}

/**
 * The engine identity the cast plate carries, derived from the same authority the
 * geometry is built from, so a plate can never name an engine that is not there:
 * bank angle from the two bore-axis azimuths, cylinder count and swept volume
 * from bore, stroke and the cylinder table.
 */
export function idPlateEngine() {
  const bankAngle = Math.abs(SPEC.banks.R.az - SPEC.banks.L.az);
  const sweptL =
    (Math.PI * SPEC.piston.radius ** 2 * 2 * SPEC.crank.radius * SPEC.cylinders.length) / 1000;
  return `V${SPEC.cylinders.length}-${bankAngle} DOHC  ${sweptL.toFixed(1)} L`;
}

/** Etched-plate label decal. */
export function labelCanvas(lines, { w = 512, h = 256, fg = '#121417', bg = '#c9ccd1', accent = '#c2571b' } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    const size = line.size ?? (i === 0 ? 46 : 26);
    ctx.font = `${line.bold ? '700' : '500'} ${size}px "DejaVu Sans Mono", monospace`;
    ctx.fillText(line.text, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (h / (lines.length + 1)));
  });
  return cv;
}

/** Analog instrument dial face. */
export function dialCanvas({ label = 'OIL', unit = 'bar', max = 6, redline = 0.85, ticks = 7, color = '#e9e2d4' } = {}) {
  const s = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#121417';
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2);
  ctx.stroke();
  const a0 = Math.PI * 0.75;
  const a1 = Math.PI * 2.25;
  for (let i = 0; i < ticks; i++) {
    const t = i / (ticks - 1);
    const a = a0 + (a1 - a0) * t;
    const long = i % 2 === 0;
    const r0 = s * (long ? 0.36 : 0.4);
    const r1 = s * 0.44;
    ctx.lineWidth = long ? 6 : 3;
    ctx.beginPath();
    ctx.moveTo(s / 2 + Math.cos(a) * r0, s / 2 + Math.sin(a) * r0);
    ctx.lineTo(s / 2 + Math.cos(a) * r1, s / 2 + Math.sin(a) * r1);
    ctx.stroke();
    if (long) {
      ctx.fillStyle = color;
      ctx.font = '600 30px "DejaVu Sans Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.round((max * t * 10) / 10)), s / 2 + Math.cos(a) * s * 0.28, s / 2 + Math.sin(a) * s * 0.28);
    }
  }
  ctx.strokeStyle = '#c2571b';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.42, a0 + (a1 - a0) * redline, a1);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = '700 34px "DejaVu Sans Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(label, s / 2, s * 0.62);
  ctx.font = '500 24px "DejaVu Sans Mono", monospace';
  ctx.fillText(unit, s / 2, s * 0.72);
  return cv;
}

// ---- textures ------------------------------------------------------------

function tex(canvas, { repeat = 4, srgb = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createEnvironment(renderer) {
  const size = 1024;
  const cv = document.createElement('canvas');
  cv.width = size * 2;
  cv.height = size;
  const ctx = cv.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#1a2028');
  grad.addColorStop(0.42, '#3b4552');
  grad.addColorStop(0.5, '#59626f');
  grad.addColorStop(0.62, '#20242a');
  grad.addColorStop(1, '#0e1013');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size * 2, size);
  // overhead test-cell light strips give the metals their sparkle
  ctx.fillStyle = 'rgba(255,250,238,0.92)';
  for (let i = 0; i < 5; i++) {
    const x = (i + 0.5) * ((size * 2) / 5);
    ctx.fillRect(x - 90, size * 0.1, 180, 46);
  }
  ctx.fillStyle = 'rgba(210,228,255,0.35)';
  for (let i = 0; i < 8; i++) {
    const x = i * ((size * 2) / 8) + 60;
    ctx.fillRect(x, size * 0.34, 120, 26);
  }
  ctx.fillStyle = 'rgba(196,110,50,0.18)';
  ctx.fillRect(0, size * 0.52, size * 2, 30);
  const texture = new THREE.CanvasTexture(cv);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envMap = pmrem.fromEquirectangular(texture).texture;
  pmrem.dispose();
  texture.dispose();
  return envMap;
}

export function createMaterials() {
  const castH = noiseCanvas(512, { seed: 71, octaves: 6, baseCells: 14, contrast: 0.55 });
  const castN = normalCanvasFromHeight(castH, 1.1);
  const aluH = noiseCanvas(512, { seed: 133, octaves: 5, baseCells: 26, contrast: 0.4 });
  const aluN = normalCanvasFromHeight(aluH, 0.8);
  const brushH = brushedCanvas(512, { seed: 9, streaks: 1400 });
  const brushN = normalCanvasFromHeight(brushH, 0.55);
  const grindH = brushedCanvas(512, { seed: 44, streaks: 2600 });
  const grindN = normalCanvasFromHeight(grindH, 0.4);

  const M = {};
  const mk = (name, params, maps = {}) => {
    const m = new THREE.MeshStandardMaterial({ name, ...params });
    if (maps.normal) {
      m.normalMap = tex(maps.normal, { repeat: maps.normalRepeat ?? 3 });
      m.normalScale = new THREE.Vector2(maps.normalScale ?? 0.6, maps.normalScale ?? 0.6);
    }
    if (maps.roughness) {
      m.roughnessMap = tex(maps.roughness, { repeat: maps.roughRepeat ?? 3 });
    }
    // no aoMap: it samples the uv1 attribute, which plain BufferGeometries do
    // not carry; unbound attributes read (0,0) and would tint whole parts.
    M[name] = m;
    return m;
  };

  mk(
    'castIronBlock',
    { color: 0x4a4e54, metalness: 0.62, roughness: 0.62, envMapIntensity: 0.85 },
    { normal: castN, roughness: castH }
  );
  mk(
    'castAluminumHead',
    { color: 0xa9afb6, metalness: 0.85, roughness: 0.44, envMapIntensity: 1.1 },
    { normal: aluN, roughness: aluH }
  );
  mk(
    'castAluminumIntake',
    { color: 0xb6bcc3, metalness: 0.88, roughness: 0.34, envMapIntensity: 1.25 },
    { normal: brushN, roughness: aluH }
  );
  mk('machinedDeck', { color: 0xc9ced4, metalness: 1, roughness: 0.22, envMapIntensity: 1.4 }, { normal: brushN, roughness: aluH });
  mk('crankShaft', { color: 0x8f969d, metalness: 1, roughness: 0.28, envMapIntensity: 1.35 }, { normal: grindN, roughness: aluH });
  mk('camShaft', { color: 0x999fa6, metalness: 1, roughness: 0.22, envMapIntensity: 1.4 }, { normal: grindN });
  mk('camLobe', { color: 0xb3b9c0, metalness: 1, roughness: 0.12, envMapIntensity: 1.6 });
  mk('rodSteel', { color: 0x878d94, metalness: 1, roughness: 0.32, envMapIntensity: 1.2 }, { normal: grindN });
  mk('bearingShell', { color: 0x6f7479, metalness: 1, roughness: 0.42, envMapIntensity: 1 });
  mk('pistonAlloy', { color: 0xd3d8dd, metalness: 0.95, roughness: 0.24, envMapIntensity: 1.35 }, { normal: brushN, normalScale: 0.3 });
  mk('ringSteel', { color: 0x5d6268, metalness: 1, roughness: 0.18, envMapIntensity: 1.4 });
  mk('boreWall', { color: 0x7d8288, metalness: 1, roughness: 0.3, envMapIntensity: 1.1, side: THREE.DoubleSide }, { normal: grindN });
  mk('valveIntake', { color: 0xb4bac1, metalness: 1, roughness: 0.22, envMapIntensity: 1.5 }, { normal: grindN, normalScale: 0.25 });
  mk('valveExhaust', { color: 0x9c8870, metalness: 1, roughness: 0.34, envMapIntensity: 1.2 });
  mk('springSteel', { color: 0x868c93, metalness: 1, roughness: 0.3, envMapIntensity: 1.3 });
  mk('bucket', { color: 0xa5abb2, metalness: 1, roughness: 0.2, envMapIntensity: 1.5 });
  mk('headerSteel', { color: 0xc7ccd1, metalness: 1, roughness: 0.16, envMapIntensity: 1.7 }, { normal: brushN, normalScale: 0.2 });
  mk('weldBead', { color: 0xa9b0b7, metalness: 1, roughness: 0.45, envMapIntensity: 1.2 });
  mk('heatShield', { color: 0x7b7268, metalness: 0.7, roughness: 0.62, envMapIntensity: 0.9 });
  mk('fastenerSteel', { color: 0x9aa0a7, metalness: 1, roughness: 0.35, envMapIntensity: 1.3 });
  mk('fastenerDark', { color: 0x53585e, metalness: 1, roughness: 0.42, envMapIntensity: 1.1 });
  mk('rubberMount', { color: 0x191c20, metalness: 0.05, roughness: 0.88, envMapIntensity: 0.5 }, { roughness: aluH });
  mk('beltRubber', { color: 0x14161a, metalness: 0.05, roughness: 0.8, envMapIntensity: 0.5 });
  mk('hoseRubber', { color: 0x21252b, metalness: 0.05, roughness: 0.72, envMapIntensity: 0.6 });
  mk('paintedOrange', { color: 0xc2571b, metalness: 0.2, roughness: 0.5, envMapIntensity: 0.85 }, { roughness: aluH });
  mk('paintedGraphite', { color: 0x2b3036, metalness: 0.35, roughness: 0.5, envMapIntensity: 0.8 }, { roughness: aluH });
  mk('paintedYellow', { color: 0xdba223, metalness: 0.2, roughness: 0.52, envMapIntensity: 0.85 });
  mk('standSteel', { color: 0x6d737a, metalness: 0.95, roughness: 0.42, envMapIntensity: 1.1 }, { roughness: aluH });
  mk('standPlate', { color: 0x3c4147, metalness: 0.85, roughness: 0.55, envMapIntensity: 0.9 }, { normal: castN, normalScale: 0.4, roughness: castH });
  mk('floorPlate', { color: 0x23272c, metalness: 0.35, roughness: 0.72, envMapIntensity: 0.6 }, { normal: castN, normalScale: 0.35, roughness: castH });
  mk('aluTube', { color: 0xb8bec5, metalness: 0.95, roughness: 0.3, envMapIntensity: 1.25 }, { normal: brushN, normalScale: 0.35 });
  mk('chainSteel', { color: 0x6b7076, metalness: 1, roughness: 0.38, envMapIntensity: 1.1 });
  mk('copperGasket', { color: 0x9a6f4a, metalness: 1, roughness: 0.4, envMapIntensity: 1.1 });
  mk('sectionFace', { color: 0xd8dde2, metalness: 0.6, roughness: 0.5, envMapIntensity: 0.9, side: THREE.DoubleSide });
  mk('gaugeFace', { color: 0xffffff, metalness: 0.1, roughness: 0.6, envMapIntensity: 0.5 });
  mk('gaugeCase', { color: 0x2f343a, metalness: 0.8, roughness: 0.4, envMapIntensity: 1 });
  mk('anodized', { color: 0x24282d, metalness: 0.7, roughness: 0.45, envMapIntensity: 0.9 });
  mk('brass', { color: 0xb99a52, metalness: 1, roughness: 0.28, envMapIntensity: 1.4 });
  mk('ceramic', { color: 0xd8d2c4, metalness: 0.05, roughness: 0.55, envMapIntensity: 0.6 });
  mk('oilFilm', { color: 0x2a2418, metalness: 0.2, roughness: 0.35, envMapIntensity: 0.7 });

  // decals / dials (colour maps)
  const hazard = M.paintedYellow;
  void hazard;
  M.hazard = new THREE.MeshStandardMaterial({ name: 'hazard', map: tex(hazardCanvas(), { repeat: 3, srgb: true }), metalness: 0.25, roughness: 0.55 });
  M.idPlate = new THREE.MeshStandardMaterial({
    name: 'idPlate',
    map: tex(
      labelCanvas(
        [
          { text: 'SATWARE TEST CELL', bold: true, size: 44 },
          // the plate reports the engine the renderer actually builds: bank angle,
          // cylinder count and swept volume all come out of the spec authority
          { text: idPlateEngine(), size: 34 },
          { text: 'MULE 01  S/N 0012-V12', size: 24 },
        ],
        { w: 1024, h: 384 }
      ),
      { repeat: 1, srgb: true }
    ),
    metalness: 0.5,
    roughness: 0.5,
  });
  M.dialRpm = new THREE.MeshStandardMaterial({ name: 'dialRpm', map: tex(dialCanvas({ label: 'RPM', unit: 'x1000', max: 4, ticks: 9, redline: 0.86 }), { repeat: 1, srgb: true }), metalness: 0.1, roughness: 0.55 });
  M.dialOil = new THREE.MeshStandardMaterial({ name: 'dialOil', map: tex(dialCanvas({ label: 'OIL', unit: 'bar', max: 6, ticks: 7, redline: 0.9 }), { repeat: 1, srgb: true }), metalness: 0.1, roughness: 0.55 });
  M.dialTemp = new THREE.MeshStandardMaterial({ name: 'dialTemp', map: tex(dialCanvas({ label: 'WATER', unit: 'deg C', max: 120, ticks: 7, redline: 0.82 }), { repeat: 1, srgb: true }), metalness: 0.1, roughness: 0.55 });
  M.dialTorque = new THREE.MeshStandardMaterial({ name: 'dialTorque', map: tex(dialCanvas({ label: 'TORQUE', unit: 'Nm', max: 400, ticks: 9, redline: 0.95 }), { repeat: 1, srgb: true }), metalness: 0.1, roughness: 0.55 });

  // spark / combustion glow, additive
  M.spark = new THREE.MeshBasicMaterial({ name: 'spark', color: 0xfff3c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  M.flame = new THREE.MeshBasicMaterial({ name: 'flame', color: 0xff9a3c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  M.exhaustGlow = new THREE.MeshBasicMaterial({ name: 'exhaustGlow', color: 0xff6a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

  return M;
}

/** Apply / clear a clipping plane on every engine material. */
export function setClipping(materials, planes) {
  for (const m of Object.values(materials)) {
    if (!m.isMeshStandardMaterial && !m.isMeshBasicMaterial && !m.isMeshPhysicalMaterial) continue;
    m.clippingPlanes = planes ?? [];
    m.clipShadows = true;
    if (m.name !== 'boreWall' && m.name !== 'sectionFace') {
      m.needsUpdate = true;
    }
  }
}
