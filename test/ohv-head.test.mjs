// Slice 8K (issue #46): the OHV head stops carrying the DOHC cam-carrier iron, and
// the casting that stays is machined so the rocker train has room to stand.
//
// Written RED first. At the commit this file is committed at, `createHeads` has no
// variant at all (issue #46 measured `grep -c variant src/render/heads.js` -> 0), so
// the OHV build bolts the DOHC head onto a block whose cam turns in the valley tunnel:
// 252 cam-carrier solids, 2 cam cap bolt meshes, 4 cam covers and 16 bucket bores.
// The probes on issue #46 measured what that costs this variant:
//   tmp/8k-covers.mjs - the inherited housings occupy bank-local along 23.67..42.94,
//     out -15.80..3.47 and -3.47..15.80 at every station, and the whole rocker train
//     (both shafts, all 16 pushrods) lands inside that envelope;
//   tmp/8k-free.mjs - the iron that stays is not clear either: the two centre webs per
//     bank stand -0.3181 cm inside the exhaust rocker shaft line, the fore/aft bulkheads
//     leave 0.6162 cm, and the 16 bucket bores come 0.4232 cm against an intake rocker.
// Slice 8J published the lever the host iron has to hold (test/ohv-valve.test.mjs:
// intake shaft out 2.5724, exhaust out 6.5917, shaft plane along 32.1513).
import test from 'node:test';
import assert from 'assert/strict';
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { SPEC, valveSide, bankUp, bankOut } from '../src/engine/spec.js';
import { createHeads } from '../src/render/heads.js';

const H = SPEC.head;
const V = SPEC.valves;
const R = SPEC.variants.ohv.rockerRatio;
const DEG = Math.PI / 180;
const LAW = 'OHV-HEAD';
const valves = ['intake', 'exhaust'];
const banks = ['L', 'R'];
const EPS = 1e-3;

const mats = () => new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) });

/** Build one variant's heads. RED today: createHeads ignores the second argument. */
function headsFor(variant) {
  const built = createHeads(mats(), variant);
  built.group.updateMatrixWorld(true);
  return built.group;
}

/** The cam-carrier families issue #46 counted, matched on the drawn part names. */
const FAMILY = {
  housing: /^housing-/,
  cap: /^cap-/,
  cradle: /^cradle-/,
  shell: /^shell-.*-(cap|cradle)$/,
  tab: /^tab-.*-(cap|cradle)-[io]$/,
  capBolts: /^cam-cap-bolts-/,
  bucketBore: /^bucketbore-/,
};
const isCarrier = (n) => /^(housing-|cap-|cradle-|shell-.*-(cap|cradle)$|tab-.*-(cap|cradle)-[io]$|cam-cap-bolts-)/.test(n);
const isCover = (n) => /^cam-cover-/.test(n);

/** Counts the published bearing stack implies - derived, never typed. */
const N = SPEC.cam.bearings.length; // 7 per bank-side
const implied = {
  housing: N * 2 * 2, cap: N * 2 * 2, cradle: N * 2 * 2,
  shell: N * 2 * 2 * 2, tab: N * 2 * 2 * 4, capBolts: banks.length,
  bucketBore: SPEC.cylinders.length * 2,
};

const count = (group, match) => {
  const hit = typeof match === 'function' ? match : (n) => match.test(n);
  let n = 0;
  group.traverse((o) => { if (hit(String(o.name))) n++; });
  return n;
};

const local = (bank, v) => {
  const u = bankUp(bank), p = bankOut(bank);
  const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const w = [v.x, v.y, v.z];
  return { x: w[0], along: d(w, u), out: d(w, p) };
};

/** The lever law slice 8J measured, re-derived here so the host iron is held to it. */
function leverLaw() {
  const out = {};
  for (const side of valves) {
    const s = valveSide(side);
    out[side] = {
      tipOut: s * (H.seatOffset + Math.sin(H.valveAngle * DEG) * H.stemToTip),
      tipAlongMax: H.seatA + Math.cos(H.valveAngle * DEG) * (H.stemToTip - V.maxLift),
    };
  }
  return out;
}

/** The constants test/ohv-valve.test.mjs measures its interface law with. */
function interfaceConstants() {
  const src = readFileSync('test/ohv-valve.test.mjs', 'utf8');
  const num = (name) => Number(new RegExp(`const ${name} = ([0-9.]+);`).exec(src)?.[1]);
  return { pad: num('PAD'), shaftR: num('SHAFT_R') };
}

const layoutOf = async () => {
  const mod = await import('../src/engine/layout.js');
  assert.equal(typeof mod.ohvRockerLayout, 'function',
    'src/engine/layout.js publishes no ohvRockerLayout(): the shaft lines, the rocker positions and the support positions are derived nowhere, so a head could machine its casting against typed coordinates and no law would notice');
  return mod.ohvRockerLayout();
};

test(`${LAW}: createHeads answers the variant it is given, and the OHV head draws none of the iron a DOHC head needs`, () => {
  const group = headsFor('ohv');
  for (const [family, re] of Object.entries(FAMILY)) {
    const drawn = count(group, re);
    assert.equal(drawn, 0,
      `the OHV head draws ${drawn} "${family}" solids (${implied[family]} implied for a DOHC head). This variant's cam turns in the block's valley tunnel (SPEC.variants.ohv.centralCam, src/engine/layout.js ohvHousing) and its valves are held by rockers, so ${family} is iron this build has no consumer for.`);
  }
  const covers = count(group, isCover);
  assert.equal(covers, 0,
    `the OHV head draws ${covers} DOHC cam covers. SPEC.variants.ohv.pendingHardware names the rocker covers this variant owes; a cover bolted over an empty cam boss is neither.`);
});

test(`${LAW}: the DOHC head still carries every cam-carrier solid the published bearing stack implies`, () => {
  const group = headsFor('dohc');
  for (const [family, re] of Object.entries(FAMILY))
    assert.equal(count(group, re), implied[family],
      `the DOHC head draws ${count(group, re)} "${family}" solids; the published stack (SPEC.cam.bearings ${N} per bank-side x 2 valve sides x 2 banks${family === 'shell' ? ' x 2 halves' : family === 'tab' ? ' x 4 retainer tabs' : family === 'capBolts' ? ': one instanced mesh per bank' : ''}) implies ${implied[family]}. A variant switch that loses DOHC iron is a different defect than the one issue #46 names.`);
  const carrier = count(group, isCarrier);
  const want = implied.housing + implied.cap + implied.cradle + implied.shell + implied.tab + implied.capBolts;
  assert.equal(carrier, want,
    `the DOHC head carries ${carrier} cam-carrier solids, expected ${want} - the 254 of 391 head meshes issue #46 counted`);
  assert.equal(count(group, isCover), valves.length * banks.length,
    `the DOHC head draws ${count(group, isCover)} cam covers, expected one per valve side per bank`);
});

test(`every caller hands createHeads the build's variant`, () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.m?js$/.test(e.name) ? [`${dir}/${e.name}`] : []);
  const files = [...walk('src'), ...walk('test')].filter((f) => f !== 'src/render/heads.js' && f !== 'test/ohv-head.test.mjs');
  let seen = 0;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('createHeads')) continue;
    for (const line of src.split('\n')) {
      const t = line.trim();
      if (/^(import|export|\*|\/\/|\/\*)/.test(t)) continue; // imports, the definition, comments
      if (!line.includes('createHeads')) continue;
      const at = line.indexOf('createHeads');
      const open = line.indexOf('(', at);
      if (open < 0)
        assert.fail(`${file} passes createHeads as a bare builder reference (${t.slice(0, 80)}), so the call it feeds cannot name a variant`);
      let depth = 0, end = -1;
      for (let i = open; i < line.length; i++) {
        if (line[i] === '(') depth++;
        else if (line[i] === ')' && --depth === 0) { end = i; break; }
      }
      const args = line.slice(open + 1, end < 0 ? line.length : end);
      seen++;
      assert.ok(/variant/i.test(args),
        `${file} calls createHeads(${args.trim()}) with no variant, so the OHV build gets the DOHC head by default - the defect issue #46 names`);
    }
  }
  assert.ok(seen > 0, 'no createHeads call site was read, so this law is not measuring the callers it names');
});

test(`${LAW}: SPEC publishes the rocker iron contract and src/engine/layout.js derives the layout from it`, async () => {
  const iron = SPEC.variants.ohv.rocker;
  assert.ok(iron, 'SPEC.variants.ohv publishes no rocker contract: the shaft radius, the pad stand-off, the arm and support widths and the fore-aft stagger are typed per file today');
  const iface = interfaceConstants();
  assert.ok(Math.abs(iron.shaftR - iface.shaftR) < EPS,
    `SPEC.variants.ohv.rocker.shaftR ${iron.shaftR} is not the ${iface.shaftR} cm shaft test/ohv-valve.test.mjs measures its interface law with: one of the two is stale`);
  assert.ok(Math.abs(iron.pad - iface.pad) < EPS,
    `SPEC.variants.ohv.rocker.pad ${iron.pad} is not the ${iface.pad} cm stand-off test/ohv-valve.test.mjs measures with`);
  const L = await layoutOf();
  const law = leverLaw();
  assert.ok(L.shaftBoreR > L.shaftR, `the published shaft bore ${L.shaftBoreR} cm is not larger than the ${L.shaftR} cm shaft it carries: a bore equal to the shaft is a bushing, not a bearing`);
  assert.ok(L.stagger >= 2.0 - EPS,
    `the two shaft planes are staggered ${L.stagger} cm; tmp/8k-fit.mjs measured an interference of 0.4799 cm at 0 cm and 1.0575 cm of air at 2.0 cm against the same cylinder's valve, so the stagger cannot be smaller`);
  for (const side of valves) {
    const row = L.sides[side];
    assert.ok(row, `the rocker layout publishes no row for the "${side}" side`);
    const lifterOut = Math.abs(row.lifterOut);
    const pivot = (R * lifterOut + law[side].tipOut) / (R + 1);
    assert.ok(Math.abs(row.pivotOut - pivot) < EPS,
      `${side}: the layout puts the shaft at out ${row.pivotOut?.toFixed(4)} while the published lever (ratio ${R}, lifter out ${lifterOut.toFixed(4)}, tip out ${law[side].tipOut.toFixed(4)}) puts it at ${pivot.toFixed(4)} - the number slice 8J measured and refused`);
    const arms = Math.abs(row.pivotOut - law[side].tipOut) / Math.abs(lifterOut - row.pivotOut);
    assert.ok(Math.abs(arms - R) < 1e-9, `${side}: the layout's arms read a lever of ${arms.toFixed(4)}, not the published ${R}`);
    const floor = law[side].tipAlongMax + iron.pad + iron.shaftR;
    assert.ok(Math.abs(row.along - floor - (side === 'intake' ? L.stagger : 0)) < EPS,
      `${side}: the layout stands the shaft at along ${row.along?.toFixed(4)}; the slice 8J interface plane is ${floor.toFixed(4)}${side === 'intake' ? ` plus the ${L.stagger} cm stagger` : ''}`);
    for (const bank of banks) {
      const perBank = SPEC.cylinders.filter((c) => c.bank === bank).length;
      assert.equal(row.rockers.filter((r) => SPEC.cylinders.find((c) => c.num === r.cyl).bank === bank).length, perBank,
        `${side} ${bank}: the layout places a rocker for ${perBank} cylinders expected, one per cylinder of the bank`);
      assert.equal(row.supports.filter((s) => s.bank === bank).length, perBank + 1,
        `${side} ${bank}: the layout places ${row.supports.filter((s) => s.bank === bank).length} shaft supports, expected ${perBank + 1} - one each side of every rocker, derived from the rocker positions`);
    }
    for (const s of row.supports)
      for (const r of row.rockers)
        assert.ok(Math.abs(s.x - r.x) > iron.armHalfWidth + iron.supportHalfWidth,
          `${side}: a support at x ${s.x.toFixed(4)} stands inside the rocker of cyl ${r.cyl} at x ${r.x.toFixed(4)} (arm half width ${iron.armHalfWidth}, support half width ${iron.supportHalfWidth})`);
  }
});

test(`${LAW}: the OHV head's own casting leaves the published rocker shaft lines free`, async () => {
  const L = await layoutOf();
  const iron = SPEC.variants.ohv.rocker;
  const group = headsFor('ohv');
  const clear = L.shaftBoreR + iron.castWall;
  const worst = { shaft: Infinity, shaftAt: '', lever: Infinity, leverAt: '' };
  group.traverse((o) => {
    if (!o.isMesh) return;
    const n = String(o.name);
    if (isCarrier(n) || isCover(n)) return; // measured by the two laws above
    const cm = /cyl(\d+)/.exec(n);
    const bank = cm ? SPEC.cylinders.find((c) => c.num === Number(cm[1])).bank : (/-(L|R)-|-(L|R)$/.exec(n)?.[1] ?? null);
    if (!banks.includes(bank)) return;
    const g = o.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < g.count; i++) {
      v.fromBufferAttribute(g, i).applyMatrix4(o.matrixWorld);
      const p = local(bank, v);
      for (const side of valves) {
        const row = L.sides[side];
        const d = Math.hypot(p.along - row.along, p.out - row.pivotOut) - clear;
        if (d < worst.shaft) { worst.shaft = d; worst.shaftAt = `${n} against the ${side} shaft`; }
      }
    }
  });
  assert.ok(worst.shaft >= -EPS,
    `${worst.shaftAt}: the casting stands ${(-worst.shaft).toFixed(4)} cm inside the room the shaft needs (${L.shaftBoreR} cm bore plus a ${iron.castWall} cm wall). tmp/8k-free.mjs measured the centre webs at -0.3181 cm and the fore/aft bulkheads at 0.6162 cm against the exhaust shaft line: the OHV casting has to be machined to the rocker clearance plane, not left at the DOHC port plane.`);
});
