// Issue #16 (slice 8C-3e, decision 2C): the build variant has to reach the shell.
//
// Every render factory already takes a variant id and every published authority in
// src/engine/layout.js derives from SPEC.build.variant, but nothing in this tree ever
// writes that field: src/main.js calls the factories with their defaults, so the OHV
// build exists in the engine modules and in the laws and in no scene. Row P1-G6's
// `?variant=` half and row A1-G6's "EXPLODED / ASSEMBLE / CUTAWAY work for both
// variants" half both wait on this.
//
// Decision 2C (recorded on issue #8): the variant is reached two ways through ONE
// authority - a `?variant=` read in src/main.js so test/screenshots.mjs and a human
// get the same build, and a control in the panel. These laws gate the authority and
// the two shell guards that have to follow it; the panel control itself is the next
// slice and is named as open here rather than assumed.
//
// What is measured, not asserted: the cell floor is not a constant this shell may
// reuse. src/engine/layout.js standDatums(id) shifts the whole stand by the depth the
// variant's own skirt reaches (OHV: -3.2000 cm), and src/render/stand.js already builds
// its feet on that shifted plane. src/ui/cameraRig.js and src/engine/view.js do not:
// both read SPEC.stand.floorZ, the DOHC plane, so switching the variant leaves the
// camera guard and the explode hoist standing 3.2 cm inside the casting they are meant
// to keep clear of the floor plate.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SPEC } from '../src/engine/spec.js';
import { standDatums, panPlanes, hudTitle, badge, engineName, plateLines } from '../src/engine/layout.js';
import { createStand } from '../src/render/stand.js';
import { engineUnits, proxyMaterials } from './support/engine-triangles.mjs';
import { focusLimits, minElevation } from '../src/ui/cameraRig.js';
import { explodeLift, explodeSpecs } from '../src/engine/view.js';

const DEFAULT_ID = SPEC.build.variant;
const EYE_MIN = SPEC.view.eyeMin;
// The hoist's own published clearance above the plate, read from the module that uses it.
const FLOOR_MARGIN = explodeSpecs().floorMargin;
// The planes below are sums of published decimals, so they are compared as lengths and
// not as bit patterns.
const NEAR = 1e-9;
const same = (a, b) => Math.abs(a - b) < NEAR;
// The stand is built from rounded boxes, and a drawn vertex is not the plane itself:
// measured here, the OHV stand's lowest vertex lands 7.6e-7 cm under the published
// -19.7000. A pairing law about a plane a part sits on is therefore held to a machining
// slack, not to a bit pattern.
const STAND_EPS = 1e-3;

/** The variant authority this slice publishes, or this law's own named failure. Read
 * per law so a missing module reds the law that needs it instead of the file at import. */
async function authority(law) {
  const mod = await import('../src/engine/variant.js').catch(() => null);
  assert.ok(mod, `${law}: src/engine/variant.js does not exist, so nothing in this tree reads a build variant off the page address or writes the switch through one door (issue #16, decision 2C)`);
  for (const fn of ['variantFromSearch', 'setVariant', 'shellDatums']) {
    assert.equal(typeof mod[fn], 'function', `${law}: src/engine/variant.js does not export ${fn}()`);
  }
  return mod;
}

/** Restore the switch whatever a law does to it. */
function withVariant(id, body) {
  SPEC.build.variant = id;
  try {
    return body();
  } finally {
    SPEC.build.variant = DEFAULT_ID;
  }
}

// ---------------------------------------------------------------------------

test('the page address selects the build variant, and a value it does not publish is named', async () => {
  const { variantFromSearch } = await authority('the address read');
  const published = Object.keys(SPEC.variants);
  const cases = [
    ['?variant=ohv', 'ohv', 'url'],
    ['?variant=dohc', 'dohc', 'url'],
    ['', DEFAULT_ID, 'default'],
    ['?', DEFAULT_ID, 'default'],
    ['?rpm=1600', DEFAULT_ID, 'default'],
  ];
  const read = cases.map(([search, wantId, wantSource]) => {
    const got = variantFromSearch(search);
    assert.equal(got.id, wantId, `variantFromSearch(${JSON.stringify(search)}) reads "${got.id}", not the "${wantId}" this case asks for`);
    assert.equal(got.source, wantSource, `variantFromSearch(${JSON.stringify(search)}) reports source "${got.source}", not "${wantSource}"`);
    assert.ok(published.includes(got.id), `variantFromSearch(${JSON.stringify(search)}) selects "${got.id}", which SPEC.variants does not publish (${published.join(', ')})`);
    return `${search || '<empty>'} -> ${got.id} (${got.source})`;
  });
  // A value the tree does not publish must fall back AND say so: a silent fallback is
  // how a mistyped address ends up looking like the build the reader asked for.
  const bad = variantFromSearch('?variant=v12');
  assert.equal(bad.id, DEFAULT_ID, `an unpublished id fell back to "${bad.id}" but the read has to land on the published default "${DEFAULT_ID}"`);
  assert.equal(bad.rejected, 'v12', `the read swallowed "v12" instead of naming it: ${JSON.stringify(bad)}`);
  console.log(`variant address read: ${read.join(', ')}, and ?variant=v12 -> ${bad.id} naming the rejected "v12"`);
});

test('switching the variant renames the shell through the one published helper', async () => {
  const { setVariant, shellDatums } = await authority('the switch');
  // plateLines is the id plate the shell stamps: each line carries its text plus its
  // weight and size, so the name read takes the text out of it.
  const names = (id) => [hudTitle(id), badge(id), engineName(id), plateLines(id).map((l) => l.text).join(' | ')];
  const before = names(DEFAULT_ID);
  const got = setVariant('ohv');
  try {
    assert.equal(got.id, 'ohv', `setVariant('ohv') returned ${JSON.stringify(got)}, which does not name the variant it was asked for`);
    assert.equal(SPEC.build.variant, 'ohv', `setVariant('ohv') did not write SPEC.build.variant, which every layout authority reads (it stayed "${SPEC.build.variant}")`);
    const after = names(SPEC.build.variant);
    assert.notDeepEqual(after, before, `the shell kept its DOHC name after the switch: "${before[0]}" is still printed for the OHV build`);
    for (const line of after) assert.ok(/OHV/.test(line), `a generated name does not follow the switch: "${line}"`);
    assert.equal(shellDatums().floorZ, standDatums('ohv').floorZ, `shellDatums() reports floor ${shellDatums().floorZ} while the stand this variant builds on stands at ${standDatums('ohv').floorZ}`);
    console.log(`switch: "${before[0]}" -> "${after[0]}" (badge ${after[1]}), shell floor ${standDatums(DEFAULT_ID).floorZ} -> ${shellDatums().floorZ}`);
  } finally {
    setVariant(DEFAULT_ID);
    assert.deepEqual(names(SPEC.build.variant), before, `the switch did not come back to the published default: ${names(SPEC.build.variant)[0]}`);
  }
});

test('the camera guard stands on the cell floor of the variant it draws, not the DOHC one', async () => {
  const { shellDatums } = await authority('the camera guard');
  const rows = ['dohc', 'ohv'].map((id) => {
    const d = standDatums(id);
    const limits = withVariant(id, () => focusLimits());
    const want = d.floorZ + EYE_MIN;
    assert.ok(same(limits.zMin, want), `with SPEC.build.variant "${id}" the rig's walk floor is ${limits.zMin.toFixed(4)} while the plane its own stand is built on is ${d.floorZ.toFixed(4)} plus the published eyeMin ${EYE_MIN} = ${want.toFixed(4)} (src/ui/cameraRig.js reads SPEC.stand.floorZ, the ${DEFAULT_ID} plane)`);
    // The pitch guard is the same plane expressed as an angle: a focus 100 cm below
    // the eye at 120 cm range has to clear the variant's plate, not another build's.
    const el = withVariant(id, () => minElevation(d.floorZ - 100, 120));
    const wantSin = (d.floorZ + EYE_MIN - (d.floorZ - 100)) / 120;
    assert.ok(Math.abs(Math.sin(el) - wantSin) < 1e-9, `minElevation answers ${el.toFixed(6)} rad, whose sine ${Math.sin(el).toFixed(6)} is not the ${wantSin.toFixed(6)} this variant's floor and range give`);
    assert.ok(same(shellDatums(id).floorZ, d.floorZ), `shellDatums("${id}") reports ${shellDatums(id).floorZ} against standDatums ${d.floorZ}`);
    return `${id}: stand floor ${d.floorZ.toFixed(4)}, rig walk floor ${limits.zMin.toFixed(4)}, minElevation ${el.toFixed(4)} rad`;
  });
  console.log(`camera guard follows the variant: ${rows.join(' | ')}`);
});

test('the switch reaches the factories: each build draws its own valvetrain on its own floor', async () => {
  const { shellDatums } = await authority('the factory switch');
  const materials = proxyMaterials();
  const rows = ['dohc', 'ohv'].map((id) => {
    const units = engineUnits(materials, id);
    const count = (root, re) => {
      let n = 0;
      root.traverse((o) => { if (o.isMesh && re.test(String(o.name))) n++; });
      return n;
    };
    const lifters = count(units.valvetrain, /^lifter-/);
    const buckets = count(units.valvetrain, /^bucket-/);
    const camshafts = count(units.valvetrain, /^camshaft-/);
    const journals = count(units.valvetrain, /^cam-V-journal/);
    if (id === 'ohv') {
      assert.equal(lifters, 16, `the OHV build draws ${lifters} lifters, not the 16 its published gallery machines bores for`);
      assert.equal(buckets, 0, `the OHV build still draws ${buckets} DOHC buckets, which nothing in its valvetrain pushes`);
      assert.equal(camshafts, 0, `the OHV build draws ${camshafts} per-bank camshafts instead of its one central cam`);
      assert.equal(journals, 5, `the OHV central cam carries ${journals} drawn journals, not the 5 ohvCam() publishes`);
    } else {
      assert.equal(lifters, 0, `the DOHC build draws ${lifters} lifters, which its valvetrain has no use for`);
      assert.equal(buckets, 48, `the DOHC build draws ${buckets} buckets, not one per cylinder`);
      assert.equal(camshafts, 4, `the DOHC build draws ${camshafts} camshafts, not two per bank`);
    }
    // The pairing the shell has to honour: the stand this variant builds lands exactly on
    // the plane shellDatums names, which is the plane src/main.js puts its floor plate on.
    const lowest = (() => {
      const stand = createStand(materials, id);
      stand.group.updateWorldMatrix(true, true);
      let lo = Infinity;
      stand.group.traverse((o) => {
        if (!o.isMesh) return;
        o.updateWorldMatrix(true, false);
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          lo = Math.min(lo, new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).z);
        }
      });
      return lo;
    })();
    assert.ok(Math.abs(lowest - shellDatums(id).floorZ) < STAND_EPS, `the stand drawn for "${id}" reaches down to z ${lowest.toFixed(6)} while shellDatums names ${shellDatums(id).floorZ.toFixed(6)} as the plate its feet sit on`);
    return `${id}: ${lifters} lifters, ${buckets} buckets, ${camshafts} camshafts, ${journals} cam journals, stand feet on ${lowest.toFixed(4)}`;
  });
  console.log(`factory switch: ${rows.join(' | ')}`);
});

test('the explode hoist lifts off the floor of the variant it draws, so the same chain needs the same lift', async () => {
  const { shellDatums } = await authority('the hoist');
  // The lowest member is the casting's own pan bottom, which moves with the variant by
  // exactly the depth its skirt reaches. If the hoist is a consequence of the chain, the
  // lift it asks for is the same number in both builds; if it reads a stale floor plane,
  // it is not.
  const lift = (id) => {
    const lowest = [{ name: 'block', minZ: panPlanes(id).panBottomZ }];
    return withVariant(id, () => explodeLift(lowest));
  };
  const a = lift('dohc');
  const b = lift('ohv');
  const shift = standDatums('ohv').floorZ - standDatums('dohc').floorZ;
  assert.ok(Math.abs(a - b) < 1e-9, `the hoist asks ${a.toFixed(4)} cm for the DOHC casting and ${b.toFixed(4)} cm for the OHV one, although that casting, its stand and its floor all move together by ${shift.toFixed(4)} cm (src/engine/view.js explodeLift reads SPEC.stand.floorZ)`);
  const want = standDatums('ohv').floorZ + FLOOR_MARGIN - panPlanes('ohv').panBottomZ;
  assert.ok(same(b, want), `the OHV lift is ${b.toFixed(4)} cm, not the ${want.toFixed(4)} cm its own floor plane ${standDatums('ohv').floorZ.toFixed(4)}, its published floorMargin ${FLOOR_MARGIN} and its pan bottom ${panPlanes('ohv').panBottomZ.toFixed(4)} give`);
  console.log(`explode hoist: dohc ${a.toFixed(4)} cm, ohv ${b.toFixed(4)} cm, stand shift ${shift.toFixed(4)} cm`);
});
