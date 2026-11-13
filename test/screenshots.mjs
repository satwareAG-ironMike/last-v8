// G7 oracle: the picture and the geometry behind it, measured on the live tree.
//
// G6 proves the controls work. This gate proves what the controls produce: that the
// thing on screen is a 60 degree V12 whose parts are attached to each other and move
// off one crank angle. Every law below is measured off the rendered meshes - live
// vertices, live group transforms - and compared against src/engine/timing.js, which is
// the authority the renderer is driven from. A mesh measured here is not a constant
// read back from the spec: the spec numbers are quoted as the expectation, the mesh is
// the evidence.
//
// Measurement discipline, each lesson bought from a wrong first answer (tmp/attach-probe.mjs):
//   - a pinned crank angle only reaches the meshes after a real animation frame, so
//     every measurement waits for frames with rpm 0 while running (state.step adds 0
//     degrees, so the angle holds and cranktrain.update(theta) still runs every frame);
//   - geometry.boundingBox is axis aligned in the MESH'S OWN frame and this renderer
//     bakes the 45 degree bank tilt into local coordinates, so extents are taken from
//     actual vertices, transformed into bank space: station, along the bore axis, out
//     of it;
//   - contact is vertex-set to vertex-set, which is an upper bound on the real gap: a
//     part whose nearest vertices are 0.05 cm away is attached, whatever its name says.
//
// The pixel laws are relational on purpose: identical vs different, wider vs narrower,
// non-blank. No invented brightness magnitude is asserted.
import { ROOT, withPage } from './support/browser.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pinned crank angles the laws are measured at. 0 is TDC for cylinders 1 and 6 and BDC
// for 4 and 7; 265 is peak exhaust lift on cylinder 1; 450 is peak intake lift on
// cylinder 4. The others spread the four strokes over the 720 degree cycle.
const ANGLES = [0, 90, 180, 265, 340, 450, 540, 719];

// ---- page-side: measure the rendered tree against the authority ----------------
// No backticks inside: this whole body is inserted into a template literal below.
const MEASURE = `(async () => {
  const v = window.__v12, THREE = v.THREE, S = v.SPEC;
  const tm = await import('/src/engine/timing.js');
  const r = (n, k) => +Number(n).toFixed(k === undefined ? 6 : k);
  const theta = v.state.theta;
  const members = v.view.members;
  const bankInv = (bank) => new THREE.Matrix4()
    .makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(...v.bankUp(bank)), new THREE.Vector3(...v.bankOut(bank)))
    .invert();

  // tight bank-space vertex extents: (station, along the bore axis, out of it)
  const extents = (name, bank, station) => {
    const o = members.get(name);
    if (!o) return null;
    o.updateWorldMatrix(true, true);
    const inv = bankInv(bank);
    const p = new THREE.Vector3();
    let alongLo = Infinity, alongHi = -Infinity, radialIn = Infinity, radialOut = 0, verts = 0;
    o.traverse((m) => {
      if (!m.isMesh || !m.geometry.attributes || !m.geometry.attributes.position) return;
      const a = m.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) {
        p.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
        if (p.y < alongLo) alongLo = p.y;
        if (p.y > alongHi) alongHi = p.y;
        const d = Math.hypot(p.x - station, p.z);
        if (d < radialIn) radialIn = d;
        if (d > radialOut) radialOut = d;
        verts += 1;
      }
    });
    return { alongLo, alongHi, radialIn, radialOut, verts };
  };
  const boxOf = (name) => {
    const o = members.get(name);
    if (!o) return null;
    o.updateWorldMatrix(true, true);
    return new THREE.Box3().setFromObject(o);
  };
  const vertsOf = (name, cap) => {
    const o = members.get(name);
    if (!o) return null;
    o.updateWorldMatrix(true, true);
    const out = [];
    o.traverse((m) => {
      if (!m.isMesh || !m.geometry.attributes || !m.geometry.attributes.position) return;
      const a = m.geometry.attributes.position;
      const stride = Math.max(1, Math.ceil(a.count / cap));
      const p = new THREE.Vector3();
      for (let i = 0; i < a.count; i += stride) out.push(p.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld).clone());
    });
    return out;
  };
  const contact = (a, b, cap) => {
    const A = vertsOf(a, cap), B = vertsOf(b, cap);
    if (!A || !B) return { missing: (A ? '' : ' ' + a) + (B ? '' : ' ' + b) };
    let best = Infinity;
    for (const p of A) for (const q of B) { const d = p.distanceTo(q); if (d < best) best = d; }
    return { gap: best };
  };

  // ---- the crank chain: rod on its crankpin, rod on its piston, piston on the authority
  const chain = [];
  for (const cyl of S.cylinders) {
    const rodG = members.get('rod-cyl' + cyl.num);
    const pistonG = members.get('piston-cyl' + cyl.num);
    rodG.updateWorldMatrix(true, true);
    pistonG.updateWorldMatrix(true, true);
    const cp = tm.crankPinPoint(cyl, theta);
    const pp = tm.pistonPinPoint(cyl, theta);
    const off = cyl.bank === 'R' ? 0.7 : -0.7; // two cylinders share one crankpin: their rods sit side by side on it
    const big = new THREE.Vector3().setFromMatrixPosition(rodG.matrixWorld);
    const small = new THREE.Vector3(0, S.rod.length, 0).applyMatrix4(rodG.matrixWorld);
    const axis = new THREE.Vector3(...v.bankUp(cyl.bank));
    const rel = new THREE.Vector3().setFromMatrixPosition(pistonG.matrixWorld);
    const along = rel.dot(axis);
    const station = S.block.stations[cyl.station];
    const pe = extents('piston-cyl' + cyl.num, cyl.bank, station);
    const le = extents('liner-cyl' + cyl.num, cyl.bank, station);
    const smallBank = small.clone().applyMatrix4(bankInv(cyl.bank));
    chain.push({
      cyl: cyl.num, bank: cyl.bank, station, stroke: tm.strokeOf(cyl, theta),
      bigEndToCrankPinPlusOff: r(big.distanceTo(new THREE.Vector3(cp.x + off, cp.y, cp.z))),
      rodSpan: r(small.distanceTo(big)),
      pistonGroupAlongError: r(Math.abs(along - tm.pistonAlong(cyl, theta))),
      smallEndToPistonPinAuthority: r(small.distanceTo(new THREE.Vector3(pp.x, pp.y, pp.z))),
      bankOffset: off,
      pistonAlong: r(pe.alongLo, 3) + '..' + r(pe.alongHi, 3),
      pistonAlongLo: r(pe.alongLo, 4), pistonAlongHi: r(pe.alongHi, 4),
      pistonRadial: r(pe.radialOut, 4),
      linerAlong: r(le.alongLo, 3) + '..' + r(le.alongHi, 3),
      linerAlongLo: r(le.alongLo, 4), linerAlongHi: r(le.alongHi, 4),
      linerHoleRadius: r(le.radialIn, 4), linerOuterRadius: r(le.radialOut, 4),
      crownToDeck: r(S.block.deckA - pe.alongHi, 4),
      skirtToBoreStart: r(pe.alongLo - S.block.boreStartA, 4),
      // piston crown radius against the liner's INNER wall: the gap the piston must
      // not run into. Measured on this build 0.07 cm, so the declared limit is 0.05.
      wallClearance: r(le.radialIn - pe.radialOut, 4),
      // bank coords: x is the crank-axis station, y is along the bore, z is out of it.
      // The side-by-side offset of two rods on one crankpin runs along the station
      // axis, so containment is measured as the radial distance to the bore axis.
      smallEndRadialToBoreAxis: r(Math.hypot(smallBank.x - station, smallBank.z), 4),
      smallEndInsidePiston:
        smallBank.y > pe.alongLo && smallBank.y < pe.alongHi && Math.hypot(smallBank.x - station, smallBank.z) < pe.radialOut,
      verts: pe.verts,
    });
  }

  // ---- the valve train: lift read out of the meshes, against the authority
  const H = S.head, V = S.valves;
  const mounted = H.stemToTip - H.retainerGap - H.guideLength;
  const valves = [];
  for (const cyl of S.cylinders) {
    for (const valve of ['intake', 'exhaust']) {
      const g = members.get('bucket-cyl' + cyl.num + '-' + valve);
      g.updateWorldMatrix(true, true);
      const d = new THREE.Vector3(...tm.valveAxisDir(cyl, valve));
      const cap = tm.camAxisPoint(cyl, valve);
      const capV = new THREE.Vector3(cap.x, cap.y, cap.z);
      const pos = new THREE.Vector3().setFromMatrixPosition(g.matrixWorld);
      const lawPoint = capV.clone().addScaledVector(d, -(H.camBaseRadius + H.bucketHeight / 2 + tm.valveLift(cyl, valve, theta)));
      const spring = members.get('spring-cyl' + cyl.num + '-' + valve);
      valves.push({
        cyl: cyl.num, valve, cycle: r(tm.cycleAngle(cyl, theta), 2), stroke: tm.strokeOf(cyl, theta),
        authority: r(tm.valveLift(cyl, valve, theta), 6),
        fromSpring: r(mounted * (1 - spring.scale.y), 6),
        bucketToPlacementLaw: r(pos.distanceTo(lawPoint)),
        noseAz: r(tm.lobeAzimuth(cyl, valve, theta), 3),
        followerAz: r(tm.followerAzimuth(cyl, valve), 3),
      });
    }
  }

  // ---- the piston really moves the way its stroke name says it does
  // measured off the live tree: bank-space along at theta-1 and theta+1.
  const motion = [];
  const live = v.state.theta;
  // A crank angle only reaches the meshes through the module that places them, so the
  // step is posed by calling it - exactly what the animation loop does every frame.
  const poseAt = (deg) => {
    v.cranktrain.update(deg);
    v.valvetrain.update(deg);
    v.engine.updateMatrixWorld(true);
  };
  const alongAt = (cyl) => {
    const o = members.get('piston-cyl' + cyl.num);
    o.updateWorldMatrix(true, true);
    return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).dot(new THREE.Vector3(...v.bankUp(cyl.bank)));
  };
  // A dead centre cannot be measured with a short step at all: one degree before and
  // one degree after top dead centre are mirror images, so a step across one reads
  // 0 cm for a piston that is plainly on its way down (that is what this law measured
  // on its first run). The law is therefore the whole cycle: across every 20 degree
  // interval of the 720 the piston must travel the direction its stroke names, and the
  // only intervals skipped are the ones that cross a stroke boundary, where reversing
  // is exactly what a dead centre is.
  // Two grids in one sweep: the monotonicity law is measured on 20 degree intervals
  // (37 samples per cylinder), and the two ends of the stroke are found on a 5 degree
  // grid. The distinction is not cosmetic - a piston's extremes sit exactly at its dead
  // centres, and a 20 degree grid can only pass within half a step of one, so the old
  // single-grid span read 7.8785 cm for the four cylinders whose dead centres fall on odd
  // multiples of 10 while their stroke is 8.0 (tmp/g7-run9.out). Shortening the step only
  // for the extremes keeps the declared interval law byte-for-byte the same, and one
  // shared sweep costs fewer poses than the old per-cylinder loops.
  const STEP_DEG = 20;
  const END_STEP_DEG = 5;
  const st = S.cylinders.map((cyl) => ({
    cyl: cyl.num, measured: 0, skipped: 0, widest: 0, firstBad: null,
    lo: Infinity, hi: -Infinity, prevStroke: null, prevAlong: null,
  }));
  const byCyl = new Map(st.map((z) => [z.cyl, z]));
  for (let a = 0; a <= 720; a += END_STEP_DEG) {
    poseAt(a % 720);
    for (const cyl of S.cylinders) {
      const z = byCyl.get(cyl.num);
      const along = alongAt(cyl);
      if (along < z.lo) z.lo = along;
      if (along > z.hi) z.hi = along;
      if (a % STEP_DEG !== 0) continue; // the interval law keeps its own, declared grid
      const stroke = tm.strokeOf(cyl, a % 720);
      if (z.prevStroke !== null) {
        if (stroke !== z.prevStroke) {
          z.skipped += 1;
        } else {
          const d = along - z.prevAlong;
          z.measured += 1;
          const down = stroke === 'POWER' || stroke === 'INTAKE';
          const ok = down ? d < -0.05 : d > 0.05;
          if (!ok && !z.firstBad) z.firstBad = { from: a - STEP_DEG, to: a, stroke, delta: r(d, 4) };
          if (Math.abs(d) > z.widest) z.widest = Math.abs(d);
        }
      }
      z.prevStroke = stroke;
      z.prevAlong = along;
    }
  }
  for (const z of st)
    motion.push({ cyl: z.cyl, measured: z.measured, skipped: z.skipped, widest: r(z.widest, 4), span: r(z.hi - z.lo, 4), firstBad: z.firstBad });
  poseAt(live);

  // ---- camshafts: half crank speed, and the lobe nose on the follower at peak lift
  const DEG = 180 / Math.PI;
  const cams = v.valvetrain.cams.map((c) => {
    const rot = ((c.rotation.x * DEG) % 360 + 360) % 360;
    return { name: c.name, rot, want: ((theta / S.cam.halfSpeedRatio) % 360 + 360) % 360 };
  });

  const pairs = [
    ['rod-cyl1', 'crank'], ['rod-cyl5', 'crank'],
    ['headers-L', 'head-L'], ['headers-R', 'head-R'], ['intake-L', 'head-L'], ['intake-R', 'head-R'],
    ['bucket-cyl1-exhaust', 'cam-L-exhaust'], ['bucket-cyl4-intake', 'cam-R-intake'],
    ['spring-cyl1-intake', 'bucket-cyl1-intake'], ['gasket-L', 'head-L'], ['gasket-R', 'head-R'],
    ['cam-cover-L-intake', 'head-L'], ['cam-cover-R-exhaust', 'head-R'],
    ['rod-cyl1', 'piston-cyl1'], ['rod-cyl4', 'piston-cyl4'],
    ['oil-pan', 'crankcase'], ['head-bolts', 'crankcase'], ['gasket-L', 'crankcase'], ['head-bolts', 'head-L'],
  ].map(([a, b]) => {
    const c = contact(a, b, 900);
    return c.missing ? { a, b, missing: c.missing } : { a, b, gap: r(c.gap, 4) };
  });

  // ---- assembled state: nothing left attached to a wrapper, nothing outlined
  const vs = v.viewState();
  let wrappers = 0;
  v.engine.traverse((o) => { if (o.parent && String(o.parent.name).indexOf('explode:') === 0) wrappers += 1; });
  let outlines = 0;
  v.scene.traverse((o) => { if (o.parent === v.scene && String(o.name).indexOf('selection') === 0) outlines += 1; });
  const union = new THREE.Box3();
  const names = [...members.keys()];
  for (const n of names) { const b = boxOf(n); if (b) union.union(b); }
  let orphan = 0;
  const gapOf = (a, b, k) => Math.max(0, Math.max(b.min[k] - a.max[k], a.min[k] - b.max[k]));
  const boxes = names.map((n) => boxOf(n));
  for (let i = 0; i < names.length; i++) {
    let best = Infinity;
    for (let j = 0; j < names.length; j++) {
      if (i === j || !boxes[i] || !boxes[j]) continue;
      const d = Math.hypot(gapOf(boxes[i], boxes[j], 'x'), gapOf(boxes[i], boxes[j], 'y'), gapOf(boxes[i], boxes[j], 'z'));
      if (d < best) best = d;
    }
    if (!(best < 1e-6)) orphan += 1;
  }

  // ---- screen coverage of one member, for the framing law
  const cover = (name) => {
    const b = boxOf(name);
    if (!b) return null;
    const cam = v.camera;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const n = new THREE.Vector3(x, y, z).project(cam);
      if (n.x < x0) x0 = n.x;
      if (n.x > x1) x1 = n.x;
      if (n.y < y0) y0 = n.y;
      if (n.y > y1) y1 = n.y;
    }
    const w = Math.max(0, Math.min(2, x1) - Math.max(-2, x0)) / 2;
    const h = Math.max(0, Math.min(2, y1) - Math.max(-2, y0)) / 2;
    return { fraction: w * h, w: r(w, 3), h: r(h, 3) };
  };

  // ---- what the assembly is really made of, read off the live meshes ----------------
  // "Realistic PBR metals" and "procedural geometry only - no downloaded models" are
  // claims about the materials the renderer hands the meshes, so they are measured there
  // instead of by grepping the source: every mesh in the scene, the material type it is
  // drawn with, the metalness/roughness of each family, and what kind of texture every
  // map on it is. A mesh left without a material gets three's default MeshBasicMaterial,
  // which is not PBR at all; a texture that came from a loader is never a CanvasTexture.
  // scene.environment is a PMREM generated from a drawn canvas (createEnvironment in
  // src/render/materials.js), not a map on a part, so it is out of this scope.
  const MAP_KINDS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'alphaMap', 'emissiveMap'];
  const textureKind = (t) => (t.isCanvasTexture ? 'canvas'
    : t.isDataTexture ? 'data'
    : t.isCompressedTexture ? 'compressed'
    : (t.constructor && t.constructor.name) || 'unknown');
  const fams = new Map();
  const typeCounts = {};
  const mapKinds = {};
  let meshCount = 0, noMaterial = 0, nonStandard = 0, mapsTotal = 0;
  const notCanvas = [];
  v.scene.traverse((o) => {
    if (!o.isMesh) return;
    meshCount += 1;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const mt of list) {
      if (!mt) { noMaterial += 1; continue; }
      typeCounts[mt.type] = (typeCounts[mt.type] || 0) + 1;
      if (!mt.isMeshStandardMaterial) nonStandard += 1;
      const key = mt.name || '(unnamed)';
      let f = fams.get(key);
      if (!f) {
        f = { name: key, type: mt.type, meshes: 0, metalness: (mt.metalness === undefined ? null : mt.metalness),
          roughness: (mt.roughness === undefined ? null : mt.roughness), maps: 0, canvasMaps: 0 };
        fams.set(key, f);
      }
      f.meshes += 1;
      for (const k of MAP_KINDS) {
        if (!mt[k]) continue;
        f.maps += 1;
        mapsTotal += 1;
        const kk = textureKind(mt[k]);
        mapKinds[kk] = (mapKinds[kk] || 0) + 1;
        if (kk === 'canvas') f.canvasMaps += 1;
        else if (notCanvas.length < 6) notCanvas.push(key + '.' + k + ' is a ' + kk);
      }
    }
  });
  const famRows = [...fams.values()].sort((a, b) => b.meshes - a.meshes).map((x) => ({
    name: x.name, type: x.type, meshes: x.meshes, metalness: x.metalness, roughness: x.roughness,
    maps: x.maps, canvasMaps: x.canvasMaps,
  }));
  const mats = {
    meshCount, noMaterial, nonStandard, mapsTotal, families: famRows.length,
    types: typeCounts, mapKinds, notCanvas, rows: famRows,
  };

  return {
    theta, members: names.length, chain, valves, motion, cams, pairs, wrappers, outlines, orphan, materials: mats,
    union: { min: [union.min.x, union.min.y, union.min.z].map((n) => r(n, 3)), max: [union.max.x, union.max.y, union.max.z].map((n) => r(n, 3)) },
    view: { fraction: vs.fraction, moved: vs.moved, cutaway: vs.cutaway, inspected: vs.inspected, engineZ: r(vs.engineZ, 4) },
    coverHome: cover('piston-cyl1'),
    spec: {
      boreRadius: S.block.boreRadius, boreStartA: S.block.boreStartA, deckA: S.block.deckA,
      stroke: S.stroke, rodLength: S.rod.length, smallEndRadius: S.rod.smallEndRadius, maxLift: V.maxLift,
      retainerGap: H.retainerGap, halfSpeedRatio: S.cam.halfSpeedRatio,
    },
  };
})()`;

// ---- page-side: pixel stats over the drawing buffer, rendered in this call ------
const PIXELS = `(() => {
  const v = window.__v12;
  v.renderer.render(v.scene, v.camera);
  const gl = v.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let hash = 2166136261;
  const feed = (byte) => { hash ^= byte; hash = (hash * 16777619) >>> 0; };
  // A fingerprint of the TREE, on an accumulator of its own and deliberately read
  // AFTER the pixels: the two questions are separate - "did the assembly move" and
  // "did the rasteriser reproduce the same picture". Sharing one number here makes a
  // rasteriser event look like a moving assembly.
  let treeHash = 2166136261;
  const mix = (num) => {
    const str = String(Math.round(num * 1e6));
    for (let i = 0; i < str.length; i++) { treeHash ^= str.charCodeAt(i); treeHash = (treeHash * 16777619) >>> 0; }
  };
  const fingerprint = (o) => {
    o.updateWorldMatrix(true, true);
    const e = o.matrixWorld.elements;
    for (let i = 0; i < 16; i++) mix(e[i]);
  };
  let lit = 0, n = 0, sum = 0, min = 255, max = 0;
  let r0 = h, r1 = -1, c0 = w, c1 = -1;
  const stride = 3;
  const samples = [];
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = (y * w + x) * 4;
      feed(px[i]); feed(px[i + 1]); feed(px[i + 2]);
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      samples.push(Math.round(l));
      n += 1; sum += l;
      if (l < min) min = l;
      if (l > max) max = l;
      if (l > 40) {
        lit += 1;
        if (y < r0) r0 = y;
        if (y > r1) r1 = y;
        if (x < c0) c0 = x;
        if (x > c1) c1 = x;
      }
    }
  }
  fingerprint(v.camera);
  fingerprint(v.engine);
  for (const o of v.view.members.values()) fingerprint(o);
  const tree = treeHash;
  let diff = null;
  if (window.__pixelRef) {
    let differing = 0, maxDelta = 0, sumDelta = 0;
    const ref = window.__pixelRef;
    for (let i = 0; i < samples.length && i < ref.length; i++) {
      const d = Math.abs(samples[i] - ref[i]);
      if (d > 0) differing += 1;
      if (d > maxDelta) maxDelta = d;
      sumDelta += d;
    }
    // maxDelta alone would hide how much the picture moved everywhere else, and a mean
    // over ALL samples would hide it in the 98% that did not move: this is the mean over
    // the pixels that changed.
    diff = {
      differing, of: samples.length, pct: +((100 * differing) / samples.length).toFixed(4), maxDelta,
      meanDelta: differing ? +(sumDelta / differing).toFixed(2) : 0,
    };
  }
  window.__pixelRef = samples;
  return {
    hash, tree, w, h, samples: n, litFraction: lit / n, min: +min.toFixed(1), max: +max.toFixed(1),
    contrast: +(max - min).toFixed(1), mean: +(sum / n).toFixed(3), diff,
    litSpan: { rows: r1 - r0, cols: c1 - c0, area: (r1 - r0) * (c1 - c0) },
    drawCalls: v.renderer.info.render.calls,
  };
})()`;

// Same watchdog reasoning as the control gate: the box is not idle (a local inference
// server measured at 273% CPU), the page runs at 1.6 fps under software rasterisation
// (tmp/hud-fps-probe.out), and the hang guard has to sit above the measured wall time
// of the gate rather than below it. No measured threshold in any law changed.
await withPage({ minFrames: 6, watchdogMs: 900000, window: '1280,800' }, async ({ evalJs, capture, errors, warnings }) => {
  const bad = [];
  const shot = async (file) => {
    const png = await capture();
    const path = join(ROOT, 'shots', file);
    writeFileSync(path, png);
    return { path, bytes: png.length };
  };
  /** Pin the crank angle and let the loop repaint the poses from it. */
  const pin = async (theta) => {
    const from = await evalJs('window.__v12.frameCount()');
    await evalJs('window.__v12.setRpm(0); window.__v12.start(); "ok"');
    await evalJs('window.__v12.state.theta = ' + theta + '; window.__v12.settleView(); "ok"');
    for (let i = 0; i < 90; i++) {
      await sleep(120);
      if ((await evalJs('window.__v12.frameCount()')) - from >= 4) return;
    }
    throw new Error('the page produced no animation frames after pinning crank ' + theta);
  };
  // The measurement walks live vertices of 136 members plus 8 cylinders x 37 piston
  // poses inside one evaluate, which is heavier than any other call this gate makes.
  // It gets a per-call timeout instead of the harness default, so a slow SwiftShader
  // host cannot make a law look like it failed (tmp/g7-run6.out: the fixed 30 s CDP
  // ceiling cut this call off mid-flight while every law was intact).
  const measure = async () => await evalJs(`(async () => (${MEASURE}))()`, { timeoutMs: 120000 });

  const resetView = async () => {
    await evalJs('window.__v12.clearInspect(); window.__v12.assemble(); window.__v12.cutaway(false); window.__v12.rig.reset(); "ok"');
    await evalJs('window.__v12.settleView(); "ok"');
  };

  // ---- the surfaces of this engine, measured off the live meshes ------------------
  // The objective asks for realistic PBR metals and for procedural geometry only, with
  // visible pistons, rods, a crankshaft, camshafts and valves. All of that is a claim
  // about what the renderer hands the meshes, so it is measured there: the material each
  // mesh actually carries, its metalness/roughness, the kind of every texture map on it,
  // and how many meshes each named part family really has. Thresholds below are declared
  // from tmp/g7-run12.out, which measured 790 meshes drawn by 31 families, 0 meshes with
  // no material, 0 meshes drawn by anything but a metal/roughness PBR material, and 847
  // texture maps of which 847 were drawn by src/render/materials.js (0 from anywhere else).
  // Three groups because a sand-cast block and a rubber mount are not polished steel and
  // a law that pretends otherwise would be false by construction: machined and driven
  // metal (measured 0.95..1.0 metalness, 0.12..0.45 roughness), as-cast metal and anodised
  // hardware (0.62..0.88, 0.44..0.62), and the painted/rubber finishes of the stand, which
  // must NOT read as metal (0.05..0.35).
  const SURFACE_GROUPS = [
    {
      name: 'machined and driven metal',
      families: ['crankShaft', 'camShaft', 'camLobe', 'rodSteel', 'pistonAlloy', 'ringSteel', 'bearingShell', 'boreWall',
        'valveIntake', 'valveExhaust', 'springSteel', 'bucket', 'headerSteel', 'weldBead', 'fastenerSteel', 'fastenerDark',
        'chainSteel', 'copperGasket', 'aluTube', 'brass', 'standSteel'],
      metalAtLeast: 0.9, roughAtMost: 0.5,
    },
    {
      name: 'as-cast metal',
      families: ['castIronBlock', 'castAluminumHead', 'castAluminumIntake', 'anodized', 'heatShield'],
      metalAtLeast: 0.5, roughAtMost: 0.7,
    },
    {
      name: 'painted and rubber finishes',
      families: ['paintedYellow', 'paintedOrange', 'paintedGraphite', 'rubberMount', 'floorPlate'],
      metalAtMost: 0.5,
    },
  ];
  // The parts the objective names, and how many meshes each of them must be drawn from:
  // eight pistons, eight rods, two banks x two camshafts, 16 valves, eight buckets,
  // eight springs, eight headers. Declared under the measured counts (pistonAlloy 8,
  // rodSteel 32, crankShaft 29, camShaft 32, camLobe 32, valveIntake 24, valveExhaust 24,
  // bucket 32, springSteel 32, ringSteel 24, headerSteel 32).
  const NAMED_METAL_MESHES = { pistonAlloy: 8, rodSteel: 8, crankShaft: 1, camShaft: 4, camLobe: 4, valveIntake: 8, valveExhaust: 8, bucket: 8, springSteel: 8, ringSteel: 8, headerSteel: 8 };
  const materialLaw = (mm, theta) => {
    if (mm.noMaterial !== 0)
      bad.push(`crank ${theta}: ${mm.noMaterial} meshes carry no material at all - three draws those with its default MeshBasicMaterial, which is not PBR`);
    if (mm.nonStandard !== 0)
      bad.push(`crank ${theta}: ${mm.nonStandard} meshes are drawn with something that is not a metal/roughness PBR material (${JSON.stringify(mm.types)})`);
    for (const k of Object.keys(mm.types))
      if (k !== 'MeshStandardMaterial' && k !== 'MeshPhysicalMaterial')
        bad.push(`crank ${theta}: the material type ${k} is not a PBR metal/roughness model, and it is on ${mm.types[k]} meshes`);
    if (mm.notCanvas.length !== 0)
      bad.push(`crank ${theta}: ${mm.notCanvas.length} texture maps were not drawn by this codebase (${mm.notCanvas.join(', ')}) - the objective forbids downloaded models and image assets`);
    if (!(mm.mapsTotal > 0))
      bad.push(`crank ${theta}: the assembly carries ${mm.mapsTotal} texture maps - the procedural-surface claim has nothing to measure`);
    if (!(mm.meshCount >= 500))
      bad.push(`crank ${theta}: only ${mm.meshCount} meshes were found in the scene (measured 790 on this build) - the audit is looking at a partial assembly`);
    if (!(mm.families >= 20))
      bad.push(`crank ${theta}: only ${mm.families} material families are in use (measured 31 on this build) - the parts are not distinguished from each other`);
    if (!(mm.mapsTotal >= 400))
      bad.push(`crank ${theta}: only ${mm.mapsTotal} procedural maps are carried (measured 847 on this build) - the surfaces are not being drawn, they are being typed`);
    for (const g of SURFACE_GROUPS) {
      for (const name of g.families) {
        const row = mm.rows.find((r) => r.name === name);
        if (!row || row.meshes === 0) {
          bad.push(`crank ${theta}: no mesh carries the ${g.name} family ${name} - ${name} is not being drawn`);
          continue;
        }
        if (g.metalAtLeast !== undefined && !(row.metalness >= g.metalAtLeast))
          bad.push(`crank ${theta}: ${name} (${row.meshes} meshes) has metalness ${row.metalness}, below the ${g.metalAtLeast} this group measures 0.62..1.0 at`);
        if (g.roughAtMost !== undefined && !(row.roughness <= g.roughAtMost))
          bad.push(`crank ${theta}: ${name} (${row.meshes} meshes) has roughness ${row.roughness}, above the ${g.roughAtMost} this group measures 0.12..0.62 at most`);
        if (g.metalAtMost !== undefined && !(row.metalness <= g.metalAtMost))
          bad.push(`crank ${theta}: ${name} is a painted/rubber finish and must not read as metal: metalness ${row.metalness} exceeds ${g.metalAtMost}`);
      }
    }
    for (const [name, want] of Object.entries(NAMED_METAL_MESHES)) {
      const row = mm.rows.find((r) => r.name === name);
      if (!row || row.meshes < want)
        bad.push(`crank ${theta}: the objective names ${name} and at least ${want} of them must be drawn; the scene carries ${row ? row.meshes : 0} meshes with that material`);
    }
  };

  // ---- the eight pinned angles: every law measured on the live tree ------------
  const runs = [];
  await resetView();
  for (const theta of ANGLES) {
    await pin(theta);
    const m = await measure();
    runs.push({ theta, m });
    if (Math.abs(m.theta - theta) > 1e-9) bad.push(`crank ${theta} was not held for the measurement (state says ${m.theta})`);
    if (m.view.fraction !== 0 || m.view.moved !== 0) bad.push(`crank ${theta}: the measurement ran on a separated view (${JSON.stringify(m.view)})`);
    if (m.wrappers !== 0) bad.push(`crank ${theta}: ${m.wrappers} engine meshes parented to an explode wrapper`);
    if (m.outlines !== 0) bad.push(`crank ${theta}: ${m.outlines} selection outlines in the scene`);
    if (m.orphan !== 0) bad.push(`crank ${theta}: ${m.orphan} members have no other member touching their box - something is floating apart`);
    materialLaw(m.materials, theta);

    for (const c of m.chain) {
      if (!(c.bigEndToCrankPinPlusOff < 1e-9))
        bad.push(`cyl ${c.cyl}: its rod's big end is ${c.bigEndToCrankPinPlusOff} cm off its crankpin at crank ${theta}`);
      if (Math.abs(c.rodSpan - m.spec.rodLength) > 1e-9)
        bad.push(`cyl ${c.cyl}: the distance between its rod's ends is ${c.rodSpan}, the published rod length is ${m.spec.rodLength} - a rod is a rigid part`);
      if (!(c.pistonGroupAlongError < 1e-9))
        bad.push(`cyl ${c.cyl}: its piston stands ${c.pistonGroupAlongError} cm from where timing.js puts the pin at crank ${theta}`);
      if (Math.abs(c.smallEndToPistonPinAuthority - Math.abs(c.bankOffset)) > 1e-9)
        bad.push(`cyl ${c.cyl}: its rod's small end is ${c.smallEndToPistonPinAuthority} cm from the piston-pin axis; the two cylinders on one crankpin sit side by side, so it must be exactly the ${Math.abs(c.bankOffset)} cm bank offset`);
      if (Math.abs(c.bankOffset) > m.spec.smallEndRadius)
        bad.push(`the ${c.bankOffset} cm side-by-side offset exceeds the ${m.spec.smallEndRadius} cm rod bush radius on cyl ${c.cyl}`);
      if (!c.smallEndInsidePiston)
        bad.push(`cyl ${c.cyl}: its rod's small end is outside its piston - the rod is not attached to the piston it drives`);
      if (c.pistonAlongLo < m.spec.boreStartA || c.pistonAlongHi > m.spec.deckA)
        bad.push(`cyl ${c.cyl}: its piston spans ${c.pistonAlong} cm along the bore, the tunnel is ${m.spec.boreStartA}..${m.spec.deckA} cm at crank ${theta}`);
      if (c.crownToDeck < 1.6)
        bad.push(`cyl ${c.cyl}: crown clearance to the deck is ${c.crownToDeck} cm at crank ${theta}; the tightest position measured on this build is 1.7 cm`);
      if (c.skirtToBoreStart < 0.9)
        bad.push(`cyl ${c.cyl}: skirt clearance to the bottom of the bore is ${c.skirtToBoreStart} cm at crank ${theta}; the tightest position measured on this build is 1.0 cm`);
      if (c.wallClearance < 0.05)
        bad.push(`cyl ${c.cyl}: ${c.wallClearance} cm between its piston outer diameter and its liner wall at crank ${theta}`);
      if (c.linerAlongLo > m.spec.boreStartA + 1e-2 || c.linerAlongHi < m.spec.deckA - 1e-2)
        bad.push(`cyl ${c.cyl}: its liner runs ${c.linerAlong} cm, the block tunnel is ${m.spec.boreStartA}..${m.spec.deckA} cm`);
    }

    let lifting = 0;
    for (const x of m.valves) {
      if (Math.abs(x.authority - x.fromSpring) > 1e-6)
        bad.push(`cyl ${x.cyl} ${x.valve}: timing.js says ${x.authority} cm of lift, the rendered spring is compressed by ${x.fromSpring} cm at crank ${theta}`);
      if (!(x.bucketToPlacementLaw < 1e-9))
        bad.push(`cyl ${x.cyl} ${x.valve}: its bucket sits ${x.bucketToPlacementLaw} cm from where the cam lift puts it at crank ${theta}`);
      if (x.authority > 0.05) lifting += 1;
    }
    if (lifting === 0) bad.push(`no valve is lifting at crank ${theta}: the four-stroke sequence is not running`);

    for (const c of m.cams) {
      if (Math.abs(c.rot - c.want) > 1e-9)
        bad.push(`${c.name} has turned ${c.rot} cam degrees at crank ${theta}; half crank speed says ${c.want}`);
    }
    for (const mo of m.motion) {
      if (mo.firstBad)
        bad.push(`cyl ${mo.cyl}: between crank ${mo.firstBad.from} and ${mo.firstBad.to} the authority says ${mo.firstBad.stroke} but its rendered piston moved ${mo.firstBad.delta} cm`);
      if (mo.measured < 30)
        bad.push(`cyl ${mo.cyl}: only ${mo.measured} of ${mo.measured + mo.skipped} intervals of its 720 degree cycle were measurable - the piston is not running through its strokes`);
      if (mo.skipped > 6)
        bad.push(`cyl ${mo.cyl}: ${mo.skipped} intervals had to be skipped as stroke boundaries; a four-stroke cycle has four of them`);
      if (!(mo.widest > 0.2))
        bad.push(`cyl ${mo.cyl}: its piston moved at most ${mo.widest} cm across a 20 degree crank step anywhere in the cycle - it is not travelling its ${m.spec.stroke} cm stroke`);
      if (Math.abs(mo.span - m.spec.stroke) > 0.05)
        bad.push(`cyl ${mo.cyl}: its piston travelled ${mo.span} cm between the ends of its own cycle, the published stroke is ${m.spec.stroke} cm`);
    }
    for (const q of m.pairs) {
      if (q.missing) bad.push(`contact pair ${q.a} <-> ${q.b}: member${q.missing} does not exist`);
    }
  }

  const mo0 = runs[0].m.motion.map((z) => `cyl${z.cyl} ${z.measured} intervals, ${z.skipped} dead centres, widest ${z.widest} cm, span ${z.span} cm`).join(', ');
  console.log(`piston motion at ${mo0}`);
  const det0 = runs[0].m.cams.map((z) => `${z.name} ${z.rot} cam deg`).join(', ');
  console.log(`cam rot at crank 0: ${det0}`);
  const v0 = runs[0].m.valves.filter((z) => z.authority > 0.01).map((z) => `cyl${z.cyl}-${z.valve} ${z.authority}`).join(', ');
  console.log(`valves lifting at crank 0: ${v0 || 'none'}`);

  // The material audit: identical at every pinned angle (the view is assembled at all of
  // them), so it is printed once and measured at all eight. Printed in full because the
  // objective asks for PBR metals and for procedural-only surfaces, and a claim about the
  // surfaces of this engine is only worth what its measured family table shows.
  const mm = runs[0].m.materials;
  console.log(
    `material audit at crank 0: ${mm.meshCount} meshes drawn by ${mm.families} material families, ` +
    `${mm.nonStandard} not metal/roughness PBR, ${mm.noMaterial} with no material at all, ` +
    `${mm.mapsTotal} texture maps (${JSON.stringify(mm.mapKinds)}), types ${JSON.stringify(mm.types)}`
  );
  console.log('material families: ' + mm.rows.map((r) => `${r.name} ${r.metalness}/${r.roughness} x${r.meshes}${r.maps ? ` maps ${r.canvasMaps}/${r.maps}` : ''}`).join(', '));

  // cam speed measured as a rate, not only as an absolute reading
  for (let i = 1; i < runs.length; i++) {
    const dTheta = runs[i].theta - runs[i - 1].theta;
    for (const c of runs[i].m.cams) {
      const prev = runs[i - 1].m.cams.find((z) => z.name === c.name);
      const turned = ((c.rot - prev.rot + 540) % 360) - 180;
      if (Math.abs(turned - dTheta / 2) > 1e-9)
        bad.push(`${c.name} turned ${turned} cam degrees while the crank moved ${dTheta}: the cam chain is not 2:1`);
    }
  }

  // peak lift lands with the lobe nose facing the follower
  const peak = runs.find((z) => z.theta === 265).m.valves.find((x) => x.cyl === 1 && x.valve === 'exhaust');
  if (Math.abs(peak.authority - 1.2) > 1e-9)
    bad.push(`cyl 1 exhaust at cycle ${peak.cycle} is ${peak.authority} cm off its seat; the published maxLift is 1.2 and this angle is the lobe nose`);
  if (Math.abs(peak.noseAz - peak.followerAz) > 1e-6)
    bad.push(`at peak lift the cyl 1 exhaust lobe nose is at ${peak.noseAz} degrees and the follower is at ${peak.followerAz}`);
  const closed = runs.find((z) => z.theta === 90).m.valves.filter((x) => x.cyl === 1 && x.valve === 'intake')[0];
  if (closed.authority !== 0)
    bad.push(`cyl 1 intake reads ${closed.authority} cm of lift at cycle ${closed.cycle}, where the intake lobe is on its base circle`);

  // four strokes genuinely go round: every stroke name appears for cylinder 1
  const seen = new Set(runs.flatMap((z) => z.m.chain.filter((c) => c.cyl === 1).map((c) => c.stroke)));
  for (const stroke of ['POWER', 'EXHAUST', 'INTAKE', 'COMPRESSION'])
    if (!seen.has(stroke)) bad.push(`cylinder 1 never showed the ${stroke} stroke across the sampled crank angles`);

  // ---- shots, and what the pixels say about them ------------------------------
  const shots = {};
  await resetView();
  await evalJs('window.__v12.stop(); window.__v12.state.theta = 0; "ok"');
  await pin(0);
  shots.home = { ...(await shot('07-home.png')), pixels: await evalJs(`(${PIXELS})`) };

  await evalJs('window.__v12.cutaway(true); "ok"');
  await sleep(400);
  shots.cutaway = { ...(await shot('08-cutaway.png')), pixels: await evalJs(`(${PIXELS})`), theta: 0 };
  if (shots.home.pixels.hash === shots.cutaway.pixels.hash)
    bad.push('CUTAWAY changed no pixel: the section is not visible in the picture');

  // The same section at the OPPOSITE dead centres: at crank 0 cylinder 1 is at top dead
  // centre and cylinder 4 at bottom dead centre; at crank 180 they swap. Two shots of the
  // same pose prove nothing (tmp/g7-run5.out produced one identical pixel hash for both,
  // because this shot was pinned at 0 like its neighbour), so it is pinned where the name
  // claims it is - and the pair is compared only after both pictures exist.
  await pin(180);
  shots.bdc = { ...(await shot('09-cutaway-tdc-bdc.png')), pixels: await evalJs(`(${PIXELS})`), theta: 180 };
  if (shots.cutaway.pixels.hash === shots.bdc.pixels.hash)
    bad.push('the two cutaway shots at crank 0 and crank 180 produced the same picture: the pistons did not travel to the opposite dead centres');

  // How far apart the two dead centres are IN THE PICTURE, measured sample to sample
  // against the crank 0 cutaway read that immediately preceded this one (PIXELS keeps
  // the previous read as its reference). Declared against tmp/g7-pair-probe.out, which
  // measured 1745 of 101626 sampled pixels differing (1.7171%), worst luminance delta
  // 232, mean delta 15.98 where a pixel moved at all: the floors sit under the
  // measurement and above the determinism ceiling of 0.5%, so the same pose stays under
  // it and the opposite dead centres must clear it.
  const pair = shots.bdc.pixels.diff;
  if (!pair) bad.push('the two cutaway pictures were never compared sample to sample');
  else {
    console.log(
      `cutaway pair at crank 0 vs crank 180: ${pair.differing} of ${pair.of} sampled pixels differ ` +
      `(${pair.pct}%), worst luminance delta ${pair.maxDelta}, mean delta ${pair.meanDelta} where a pixel moved`
    );
    if (pair.pct < 1)
      bad.push(`the cutaway at crank 0 and the cutaway at crank 180 differ on only ${pair.pct}% of ${pair.of} sampled pixels: the pistons did not travel to the opposite dead centres`);
    if (pair.maxDelta < 40)
      bad.push(`the largest luminance difference between the two cutaway poses is ${pair.maxDelta}: the picture did not change where the pistons are`);
  }

  // Round trip: pin the FIRST pose again and the engine must produce the picture it left,
  // measured as the same distance back to the crank 180 picture. A view machinery that
  // eased, sectioned and re-posed its way through the pair and came out somewhere else
  // would show up here as a different distance. The probe measured both distances as
  // exactly the same 1745 pixels / 1.7171% / maxDelta 232.
  await pin(0);
  const back = await evalJs(`(${PIXELS})`);
  if (!back.diff) bad.push('the trip back to crank 0 was never compared with the crank 180 picture');
  else {
    console.log(
      `round trip crank 0 -> 180 -> 0: the picture at the second crank 0 is ${back.diff.differing} of ` +
      `${back.diff.of} sampled pixels (${back.diff.pct}%) from the crank 180 picture, worst delta ${back.diff.maxDelta}`
    );
    if (Math.abs(back.diff.pct - pair.pct) > 0.5)
      bad.push(`crank 0 gave ${pair.pct}% against crank 180 the first time and ${back.diff.pct}% the second: the engine did not come back to the picture it left`);
    if (Math.abs(back.diff.maxDelta - pair.maxDelta) > 40)
      bad.push(`the worst luminance distance to the crank 180 picture changed from ${pair.maxDelta} to ${back.diff.maxDelta} across the round trip`);
  }

  await evalJs('window.__v12.cutaway(false); "ok"');
  await sleep(300);

  // Cylinders 1 and 4 are the pair the gate pinned: crank 0 leaves 1 at top dead centre
  // and 4 at bottom dead centre (measured off the meshes, not assumed), and crank 180 must
  // swap them. Their crowns are the topmost vertex of each piston.
  const stroke = runs[0].m.spec.stroke;
  const at0 = runs[0].m.chain;
  const at180 = runs.find((z) => z.theta === 180).m.chain;
  const swap = [1, 4].map((cyl) => {
    const a = at0.find((c) => c.cyl === cyl);
    const b = at180.find((c) => c.cyl === cyl);
    return { cyl, crown0: a.pistonAlongHi, crown180: b.pistonAlongHi, travel: +(a.pistonAlongHi - b.pistonAlongHi).toFixed(4) };
  });
  for (const sw of swap)
    if (Math.abs(Math.abs(sw.travel) - stroke) > 0.3)
      bad.push(`cyl ${sw.cyl}: its crown stands ${sw.crown0} cm up the bore at crank 0 and ${sw.crown180} cm at crank 180, a travel of ${sw.travel} cm where the published stroke is ${stroke} cm`);
  if (!(swap[0].travel > 0 && swap[1].travel < 0))
    bad.push(`cyl 1 moved ${swap[0].travel} cm and cyl 4 ${swap[1].travel} cm between crank 0 and crank 180: the two cylinders the gate pinned are not at opposite dead centres`);
  console.log('dead centres at crank 0 vs 180: ' + swap.map((sw) => `cyl${sw.cyl} crown ${sw.crown0} -> ${sw.crown180} cm (travel ${sw.travel})`).join(', '));

  // determinism: the same pose twice must be the same picture, byte for byte in the
  // sampled pixels; a scene that jitters between frames is not driven by the crank
  const twice = await evalJs(`(${PIXELS})`);
  const thrice = await evalJs(`(${PIXELS})`);
  if (twice.tree !== thrice.tree)
    bad.push(`the rendered tree changed between two reads of the same pinned pose (${twice.tree} -> ${thrice.tree}): the assembly is not a function of the crank angle`);
  const px = thrice.diff;
  console.log(`determinism at one pose: tree ${twice.tree} == ${thrice.tree}, pixels ${twice.hash} vs ${thrice.hash}, sampled ${thrice.samples}: ${px ? px.differing + ' differing, worst luminance delta ' + px.maxDelta : 'no comparison'}`);
  if (!px) bad.push('the determinism measurement produced no pixel comparison');
  else {
    if (px.pct > 0.5)
      bad.push(`${px.differing} of ${px.of} sampled pixels (${px.pct}%) differ between two renders of the same pinned pose; the measured worst case on this build is 0.2125%`);
    if (px.maxDelta > 60)
      bad.push(`two renders of the same pinned pose differ by ${px.maxDelta} luminance at one pixel; the measured worst case on this build is 48`);
  }

  await evalJs('window.__v12.setRpm(1800); window.__v12.setSlowmo(1); window.__v12.start(); "ok"');
  await sleep(700);
  shots.running = { ...(await shot('10-running.png')), pixels: await evalJs(`(${PIXELS})`) };
  await evalJs('window.__v12.stop(); "ok"');

  await evalJs('window.__v12.explode(); "ok"');
  for (let i = 0; i < 160; i++) {
    await sleep(100);
    const vs = JSON.parse(await evalJs('JSON.stringify(window.__v12.viewState())'));
    if (1 - vs.fraction < 1e-6 && vs.moved > 0) break;
    if (i === 159) bad.push('EXPLODED VIEW never settled to the published 34.25 cm hoist');
  }
  await pin(0);
  shots.exploded = { ...(await shot('11-exploded.png')), pixels: await evalJs(`(${PIXELS})`) };
  const apart = JSON.parse(
    await evalJs(`JSON.stringify((() => {
      const v = window.__v12, THREE = v.THREE;
      const u = new THREE.Box3();
      for (const o of v.view.members.values()) { o.updateWorldMatrix(true, true); u.union(new THREE.Box3().setFromObject(o)); }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity, worst = 0;
      for (const x of [u.min.x, u.max.x]) for (const y of [u.min.y, u.max.y]) for (const z of [u.min.z, u.max.z]) {
        const n = new THREE.Vector3(x, y, z).project(v.camera);
        worst = Math.max(worst, Math.abs(n.x), Math.abs(n.y));
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      void x0; void x1; void y0; void y1; void z0; void z1;
      return { span: [+(x1 - x0).toFixed(3), +(y1 - y0).toFixed(3), +(z1 - z0).toFixed(3)], worstNdc: +worst.toFixed(3), moved: v.viewState().moved, engineZ: +v.viewState().engineZ.toFixed(3) };
    })())`)
  );
  // runs[0] is the measurement taken at crank 0 while the engine is assembled; reading
  // the union a second time here would read the exploded tree and compare it to itself
  const assembledBox = runs[0].m.union;
  const home = [
    +(assembledBox.max[0] - assembledBox.min[0]).toFixed(3),
    +(assembledBox.max[1] - assembledBox.min[1]).toFixed(3),
    +(assembledBox.max[2] - assembledBox.min[2]).toFixed(3),
  ];
  for (let k = 0; k < 3; k++)
    if (!(apart.span[k] > home[k]))
      bad.push(`EXPLODED VIEW spans ${apart.span[k]} cm on axis ${'xyz'[k]}, the assembled engine already spans ${home[k]} cm - the parts did not move apart`);
  if (!(apart.worstNdc <= 1))
    bad.push(`the separated assembly is cropped on screen: its farthest corner projects to ${apart.worstNdc} in ndc`);
  if (apart.moved === 0) bad.push('EXPLODED VIEW moved 0 members');
  if (shots.exploded.pixels.hash === shots.home.pixels.hash)
    bad.push('the separated assembly produced the same picture as the assembled one');
  console.log(`spread law: assembled ${home.join(' x ')} cm -> exploded ${apart.span.join(' x ')} cm, worst corner ndc ${apart.worstNdc}, ${apart.moved} members hoisted ${apart.engineZ} cm`);
  await evalJs('window.__v12.assemble(); window.__v12.settleView(); "ok"');
  await sleep(1500);

  await evalJs('window.__v12.inspect("piston-cyl1"); "ok"');
  await sleep(1200);
  await pin(0);
  shots.inspect = { ...(await shot('12-inspect-piston.png')), pixels: await evalJs(`(${PIXELS})`) };
  const framed = await measure();
  if (!framed.coverHome || !framed.coverHome.fraction) bad.push('the inspected piston covers no area on screen');
  else if (!(framed.coverHome.fraction > runs[0].m.coverHome.fraction))
    bad.push(`PART INSPECTION framed piston-cyl1 to ${(framed.coverHome.fraction * 100).toFixed(1)}% of the frame, the home view already showed ${(runs[0].m.coverHome.fraction * 100).toFixed(1)}%`);
  console.log(
    `framing law: piston-cyl1 covers ${(runs[0].m.coverHome.fraction * 100).toFixed(1)}% of the frame assembled, ` +
    `${(framed.coverHome.fraction * 100).toFixed(1)}% when inspected`
  );
  await evalJs('window.__v12.clearInspect(); window.__v12.rig.reset(); "ok"');
  await sleep(1400);

  for (const [name, s] of Object.entries(shots)) {
    if (s.pixels.samples < 1000) bad.push(`shot ${name}: only ${s.pixels.samples} pixels sampled`);
    if (s.pixels.contrast <= 0) bad.push(`shot ${name} is flat: every sampled pixel is the same luminance`);
    if (s.pixels.litFraction < 0.05) bad.push(`shot ${name} covers only ${(s.pixels.litFraction * 100).toFixed(1)}% lit pixels`);
    console.log(
      `shot ${name.padEnd(9)} ${s.bytes} bytes  buffer ${s.pixels.w}x${s.pixels.h}  lit ${(s.pixels.litFraction * 100).toFixed(1)}%  ` +
        `mean ${s.pixels.mean}  min ${s.pixels.min} max ${s.pixels.max}  span ${s.pixels.litSpan.rows}x${s.pixels.litSpan.cols}  calls ${s.pixels.drawCalls}  hash ${s.pixels.hash}`
    );
  }

  // contact numbers measured here, printed so the thresholds above are auditable
  const last = runs[0].m.pairs.map((q) => (q.missing ? `${q.a}<->${q.b} MISSING` : `${q.gap}cm ${q.a}<->${q.b}`));
  console.log('contacts at crank 0: ' + last.join('  '));
  for (const [lim, pair] of [
    [0.06, 'rod-cyl1<->crank'], [0.06, 'rod-cyl5<->crank'],
    [2.0, 'rod-cyl1<->piston-cyl1'], [2.0, 'rod-cyl4<->piston-cyl4'],
    [0.08, 'headers-L<->head-L'], [0.08, 'headers-R<->head-R'],
    [0.08, 'intake-L<->head-L'], [0.08, 'intake-R<->head-R'],
    [0.45, 'bucket-cyl1-exhaust<->cam-L-exhaust'], [0.45, 'bucket-cyl4-intake<->cam-R-intake'],
    [0.42, 'spring-cyl1-intake<->bucket-cyl1-intake'],
    [0.06, 'cam-cover-L-intake<->head-L'], [0.06, 'cam-cover-R-exhaust<->head-R'],
    [0.2, 'gasket-L<->head-L'], [0.2, 'gasket-R<->head-R'],
  ]) {
    const q = runs[0].m.pairs.find((z) => `${z.a}<->${z.b}` === pair);
    if (q && !q.missing && !(q.gap <= lim)) bad.push(`${pair} are ${q.gap} cm apart, the declared contact limit is ${lim} cm`);
  }

  const u0 = runs[0].m.union;
  console.log(`assembled union at crank 0: ${u0.min.join(',')} .. ${u0.max.join(',')}`);
  console.log(`chain at crank 0: cyl1 big-end error ${runs[0].m.chain[0].bigEndToCrankPinPlusOff}, rod span ${runs[0].m.chain[0].rodSpan}, piston along ${runs[0].m.chain[0].pistonAlong} in liner ${runs[0].m.chain[0].linerAlong}, radial ${runs[0].m.chain[0].pistonRadial} against hole ${runs[0].m.chain[0].linerHoleRadius} (liner outer ${runs[0].m.chain[0].linerOuterRadius})`);
  console.log(`valves at crank 265: cyl1 exhaust authority ${runs.find((z) => z.theta === 265).m.valves[1].authority} spring ${runs.find((z) => z.theta === 265).m.valves[1].fromSpring}`);

  // A picture rendered by a page that logged an error is not a working simulation: the
  // harness (test/support/browser.mjs) collects every console.error, page exception, CDP
  // log entry of level error and target crash, and this gate reads them into a law too.
  if (warnings.length) console.log(`warnings: ${warnings.length} (${warnings.slice(0, 3).join(' | ')})`);
  console.log(`console/CDP errors: ${errors.length}${errors.length ? '\n  ' + errors.join('\n  ') : ''}`);
  if (errors.length) bad.push(`${errors.length} console/CDP error(s) while the gate rendered its pictures`);

  if (bad.length) {
    console.log('\nSHOTS INCOMPLETE:');
    for (const b of bad) console.log('  ' + b);
    console.log(`shots: ${Object.keys(shots).length} written, laws sampled at ${ANGLES.length} pinned crank angles`);
    process.exitCode = 1;
    return;
  }
  console.log(
    '\nSHOTS OK: the rendered assembly is driven by one crank angle - rods on their crankpins, rods on their pistons, ' +
      'pistons in their bores, cams at half crank speed, lobes lifting the valves the timing module says, ' +
      'nothing left floating apart, and the same pose gives the same picture'
  );
});
