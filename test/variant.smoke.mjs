// Issue #16 (slice 8C-3e, decision 2C) live gate: the address is the door a reader and
// the screenshot harness walk through, and this measures it in the page rather than in
// Node.
//
// Three boots, each a real navigation:
//   /               the build this tree draws by default
//   /?variant=ohv   the OHV build, asked for the way a reader would ask for it
//   /?variant=v12   a variant this tree does not publish: the page must draw the default
//                   AND name what it refused
//
// What is read is what the page shows: window.__v8.variant(), the HUD title element, the
// floor plate's own world position, the parts the engine group really contains, the
// lowest drawn face of the stand the engine hangs from, and the walk floor the app's own
// cameraRig module answers for the build it is framing. The expectation comes from
// src/engine/layout.js standDatums in Node; the evidence is the live scene.
import { withPage } from './support/browser.mjs';
import { standDatums } from '../src/engine/layout.js';

const fail = (why) => {
  console.error(`VARIANT FAIL: ${why}`);
  process.exitCode = 1;
};

// A drawn vertex is not the plane it sits on (the stand is built from rounded boxes):
// the same slack test/variant.test.mjs holds the pairing to.
const STAND_EPS = 1e-3;

const CASES = [
  { query: '', want: 'dohc', rejected: null },
  { query: '?variant=ohv', want: 'ohv', rejected: null },
  { query: '?variant=v12', want: 'dohc', rejected: 'v12' },
];

/** Everything in these backticks runs in the page, so every helper is declared inside. */
const SCENE_READ = `(() => {
  const out = { floorZ: null, lifters: 0, buckets: 0, camshafts: 0, journals: 0, standLowest: Infinity, meshes: 0 };
  window.__v8.scene.traverse((o) => {
    if (o.isMesh && o.material && o.material.name === 'floorPlate') out.floorZ = o.getWorldPosition(new window.__v8.THREE.Vector3()).z;
  });
  window.__v8.engine.traverse((o) => {
    if (!o.isMesh) return;
    out.meshes++;
    const n = String(o.name);
    if (/^lifter-/.test(n)) out.lifters++;
    if (/^bucket-/.test(n)) out.buckets++;
    if (/^camshaft-/.test(n)) out.camshafts++;
    if (/^cam-V-journal/.test(n)) out.journals++;
  });
  const st = window.__v8.stand.group;
  st.updateWorldMatrix(true, true);
  st.traverse((o) => {
    if (!o.isMesh) return;
    o.updateWorldMatrix(true, false);
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = new window.__v8.THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).z;
      if (z < out.standLowest) out.standLowest = z;
    }
  });
  return JSON.stringify(out);
})()`;

const NAMES = `(() => JSON.stringify({
  variant: window.__v8.variant(),
  variants: window.__v8.variants(),
  param: window.__v8.variantParam,
  rejected: window.__v8.variantRejected(),
  title: document.getElementById('engine-name').textContent,
}))()`;

const RIG_READ = `Promise.all([import('/src/ui/cameraRig.js'), import('/src/engine/spec.js')]).then(([rig, spec]) => JSON.stringify({ zMin: rig.focusLimits().zMin, eyeMin: spec.SPEC.view.eyeMin }))`;

try {
  for (const c of CASES) {
    await withPage({ query: c.query, minFrames: 10, watchdogMs: 120000 }, async ({ evalJs, errors, pageUrl }) => {
      const names = JSON.parse(await evalJs(NAMES));
      const scene = JSON.parse(await evalJs(SCENE_READ));
      const rig = JSON.parse(await evalJs(RIG_READ));
      const want = standDatums(c.want);

      if (errors.length) throw new Error(`${errors.length} console/CDP error(s) at ${pageUrl}:\n  ${errors.join('\n  ')}`);
      if (names.variant !== c.want) throw new Error(`${pageUrl}: the page draws "${names.variant}", not "${c.want}"`);
      if (names.param !== 'variant') throw new Error(`${pageUrl}: the address parameter is published as "${names.param}", not "variant"`);
      if (!names.variants.includes('ohv') || !names.variants.includes('dohc')) throw new Error(`${pageUrl}: the page publishes ${names.variants.join(', ')}, not both builds`);
      if (names.rejected !== c.rejected) throw new Error(`${pageUrl}: rejected reads ${JSON.stringify(names.rejected)}, expected ${JSON.stringify(c.rejected)}`);
      if (!names.title.includes(c.want.toUpperCase())) throw new Error(`${pageUrl}: the HUD title names "${names.title}" for the ${c.want} build`);
      if (scene.floorZ === null) throw new Error(`${pageUrl}: no floor plate found in the live scene`);
      if (Math.abs(scene.floorZ - want.floorZ) > STAND_EPS) throw new Error(`${pageUrl}: the floor plate stands at z ${scene.floorZ.toFixed(4)} while the stand this build is drawn on is built on ${want.floorZ.toFixed(4)}`);
      if (Math.abs(scene.standLowest - want.floorZ) > STAND_EPS) throw new Error(`${pageUrl}: the drawn stand reaches ${scene.standLowest.toFixed(4)} against its own floor plate at ${scene.floorZ.toFixed(4)}`);
      if (Math.abs(rig.zMin - (want.floorZ + rig.eyeMin)) > 1e-9) throw new Error(`${pageUrl}: the app's own cameraRig answers walk floor ${rig.zMin.toFixed(4)}, expected ${want.floorZ.toFixed(4)} + its published eyeMin ${rig.eyeMin}`);
      if (c.want === 'ohv' && (scene.lifters !== 16 || scene.buckets !== 0 || scene.camshafts !== 0)) throw new Error(`${pageUrl}: the OHV scene draws ${scene.lifters} lifters, ${scene.buckets} buckets, ${scene.camshafts} camshafts`);
      if (c.want === 'dohc' && (scene.lifters !== 0 || scene.buckets !== 48 || scene.camshafts !== 4)) throw new Error(`${pageUrl}: the DOHC scene draws ${scene.lifters} lifters, ${scene.buckets} buckets, ${scene.camshafts} camshafts`);

      console.log(`${pageUrl.replace(/^http:\/\/127\.0\.0\.1:\d+/, 'page') || 'page /'}: variant ${names.variant} (rejected ${JSON.stringify(names.rejected)}), title "${names.title}", ${scene.meshes} engine meshes (${scene.lifters} lifters, ${scene.buckets} buckets, ${scene.camshafts} camshafts, ${scene.journals} cam journals), floor ${scene.floorZ.toFixed(4)}, stand lowest ${scene.standLowest.toFixed(4)}, rig walk floor ${rig.zMin.toFixed(4)}`);
    });
  }
  console.log('VARIANT OK');
} catch (e) {
  fail(e.message);
}
