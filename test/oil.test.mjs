// Slice 8D-1 (issue #8 addendum item 5, GATES row A1-G4): the oil NETWORK of both
// builds - pump, pan pickup, main gallery, a feed drilling to every main bearing,
// through the crank to every rod bearing, and on to every cam bearing, every feed
// traced back to the pump.
//
// Written RED first: `src/engine/oil.js` does not exist yet, so every law below
// reds itself on the import. Every route these laws publish was first sampled at its
// real drilling radius against the drawn iron (test/support/oil-iron.mjs): the settled
// set is tmp/8d-published.mjs -> tmp/8d-published5.out, 78 published routes, 78 clean,
// every one proven with only its own named terminus part and its own named oil spaces
// allowed, and with an EMPTY allow list wherever the drawn iron alone is enough
// (tmp/8d-strict.out). Each law gates one contract measured there.
//
// What this file gates, with the numbers it measured:
//   the wall band - ID 9.4 / OD 11.6 about the crank axis, mid radius 10.5, so a
//     gallery bored at the mid radius holds (OD-ID)/2 - housingWall = 0.5 cm of
//     bore with SPEC.cam.bearing.housingWall 0.60 cm of iron left on BOTH sides;
//   the main bearings - 5 at MAIN_CAPS_X, each drawn as main-shell-x*, measured
//     radial band 2.7500..3.4500 in both variants, so a feed ends on 3.4500;
//   the rod bearings - 4 at SPEC.block.stations, drawn rod big-end bore band
//     2.4500..3.1000 over a 2.4 cm crank pin: the film is the 0.05 between them;
//   the cam bearings - DOHC 4 cam groups x SPEC.cam.bearings 7 journals = 28, all
//     56 shell halves drawn in the heads; OHV 5 tunnel bushings cam-bushing-1..5,
//     world band 3.1400..3.4000 about the cam axis at z -10.8;
//   the block->head route - only the OUTBOARD flanks are reachable from the wall band:
//     each bank's bore tunnel (liner face 5.45 from boreStartA 5.5 up to the deck 24.1)
//     blocks azimuth 13..77 and 283..347 of the annulus at r 10.5, the gallery stands at
//     azimuth 180 and an inboard flank at about azimuth 11, so no arc joins them and a
//     valley leg plows a press-fit liner either way round (tmp/8d-linkdir.out,
//     tmp/8d-whered.mjs). The two inboard rails are fed through the head's own chimney
//     iron instead, which stands continuous from along 25.5 to 32 at |x| >= 22 and is a
//     cylinder bore at every station (tmp/8d-bridge.out, tmp/8d-cross.out). The rail
//     geometry is derived, not typed: out (gasketId+gasketOd)/2 = 6.25, along
//     (deckA+gasketT+railTopA)/2 = 25.625;
//   the OHV route - its iron is not the DOHC one: no part of the current casting
//     bridges the two banks at the tunnel crown (every straight cross leg at x
//     +/-24..27.5 is open air, tmp/8d-ohvfore.out; no iron-only corridor exists at 11
//     stations, tmp/8d-ohvcross3.out), so the gallery pair bored on the machined
//     tunnel crown plane -(belowCrankCm - tunnelWallR) = -6.8 at the wall mid radius,
//     y = sqrt(10.5^2 - 6.8^2) = 8.0006, is only fillable on one side. The fed
//     gallery is the outboard one; its 3 mid main feeds run the measured boot-leg
//     corridor (tmp/8d-ohvmain.out) and its 5 cam feeds enter the bushing bore due
//     outboard at azimuth 90, the one azimuth where drawn iron stands on the tunnel
//     wall from r 3.40 to 4.28 (tmp/8d-gap10.out, tmp/8d-ohvfix.out).
//
// What this file does NOT gate, and says so:
//   - the OHV LIFTER GALLERY feed. SPEC.variants.ohv.drawn is false and issue #16
//     has not chosen a casting option yet, so no lifter gallery exists to feed.
//     Law 10 names that clause as pending instead of pretending it is done.
//   - the OHV fore and aft main bearings and the OHV inboard gallery. The drawn
//     carriers stand 4.70 cm off the wall band and no iron bridges the banks at the
//     crown plane, so neither can be bored to (issue #28). Law 3 and law 8 name them
//     as a pending clause on that issue; the published OHV census is 3 fed mains of 5.
//   - the DRAWN oil parts and the drilled oil holes in the shells: slice 8D-2
//     (src/render/oil.js, holes in main-shell-* and in the bearing shells) with
//     its own laws added to this file and to test/block.test.mjs. Law 11 names the
//     drawn-holes census as that clause while no oil- part is drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BANKS,
  MAIN_CAPS_X,
  SPEC,
  bankOut,
  bankUp,
  camAxisBank,
  camAzimuths,
  polarDir,
} from '../src/engine/spec.js';
import {
  camGroupNames,
  crankSwings,
  ohvBearings,
  ohvHousing,
  panPlanes,
} from '../src/engine/layout.js';
import { createBlock } from '../src/render/block.js';
import { createCranktrain } from '../src/render/cranktrain.js';
import { createHeads } from '../src/render/heads.js';
import { bearingStack } from '../src/engine/bearings.js';
import { oilOracle } from './support/oil-iron.mjs';

// Imported inside each law, not at module scope: a top-level import of a name the
// tree does not export yet reds the whole file instead of the law.
const O = () => import('../src/engine/oil.js');

const B = SPEC.block;
const CR = SPEC.crank;
const RD = SPEC.rod;
const CAM = SPEC.cam;
const STACK = bearingStack(); // the published wall contract: housingWall 0.60
const VAR = SPEC.variants;
const EPS = 1e-4;
const DEG = Math.PI / 180;

const ID = B.crankcaseRadius; // 9.4 the crankcase bore
const OD = B.caseOuterRadius; // 11.6 the casting OD
const WALL = CAM.bearing.housingWall; // 0.60 the thickest-but-one published wall
const MID_R = (ID + OD) / 2; // 10.5 the wall band mid radius
const SHELL_IN = CR.mainRadius + 0.05; // 2.75 main bearing shell inside
const SHELL_OUT = SHELL_IN + 0.7; // 3.45 its outside, pressed into the bore
const ROD_BORE_IN = CR.pinRadius + 0.05; // 2.45 rod big-end bore over the 2.4 pin
const HEAD = SPEC.head;
const DECK_FACE = B.deckA + HEAD.gasketT; // 24.25 the machined head deck face
const RAIL_OUT = (HEAD.gasketId + HEAD.gasketOd) / 2; // 6.25 the mid of the drawn deck rail
const RAIL_BAND = (DECK_FACE + HEAD.railTopA) / 2; // 25.625 the mid of the drawn rail band

const mats = () => new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) });

function posed(root) {
  root.updateMatrixWorld(true, true);
  return root;
}

function blockOf(variant) {
  return posed(createBlock(mats(), variant));
}

/** A drawn part by name, or the law says which one the tree does not draw. */
function partOf(root, name) {
  const o = root.getObjectByName(name);
  assert.ok(o, `the tree draws no part named ${name}`);
  return o;
}

/** Radial band (about local X) of a drawn part's own vertices. */
function radialBand(root, name, centre = [0, 0]) {
  const o = partOf(root, name);
  const p = o.geometry.attributes.position;
  const m = o.matrixWorld;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m);
    const r = Math.hypot(v.y - centre[0], v.z - centre[1]);
    lo = Math.min(lo, r);
    hi = Math.max(hi, r);
  }
  return { lo, hi, x: new THREE.Box3().setFromObject(o) };
}

/** Every drawn cam bearing the heads machine, as `camGroup@station` in the names
 * camGroupNames() publishes: the heads draw `shell-R-intake--27.5-cradle`, the
 * engine calls that group `cam-R-intake`. */
function drawnCamBearings() {
  const out = new Map();
  posed(createHeads(mats()).group).traverse((o) => {
    if (!o.isMesh) return;
    const m = /^shell-([A-Za-z]+-[A-Za-z]+)-(-?[\d.]+)-(cap|cradle)$/.exec(o.name);
    if (!m) return;
    out.set(`cam-${m[1]}@${m[2]}`, o);
  });
  return out;
}

/** World position of a DOHC cam journal: the published bank frame at station x. */
function camJournalWorld(group, x) {
  const [, bank, valve] = group.split('-');
  const [along, outboard] = camAxisBank(bank, valve);
  const u = polarDir(BANKS[bank].az); // up the bore axis
  const v = polarDir(BANKS[bank].az + BANKS[bank].outSign * 90); // outboard
  return [x, along * u[1] + outboard * v[1], along * u[2] + outboard * v[2]];
}

/** Distance from a point to a line through `origin` with unit direction `dir`. */
function offAxis(p, origin, dir) {
  const a = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
  const d = a[0] * dir[0] + a[1] * dir[1] + a[2] * dir[2];
  return Math.hypot(Math.hypot(a[0] - d * dir[0], a[1] - d * dir[1]), a[2] - d * dir[2]);
}

/** Sample a feed's polyline at 0.25 cm: the points a drill actually passes through. */
function alongFeed(feed, step = 0.25) {
  const pts = feed.path.map((p) => (Array.isArray(p) ? p : [p.x, p.y, p.z]));
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
    out.push(b.slice());
  }
  return out;
}

/** The OHV published iron route a mid main feed must follow. */
function ohvIron() {
  const H = ohvHousing();
  return {
    H,
    crownZ: -(H.belowCrankCm - H.tunnelWallR), // the machined tunnel crown the cap bar stands on
    legMidY: (H.skirtHalfY + H.skirtInboardY) / 2, // the boot leg's own centre line
    camAxis: [0, 0, -H.belowCrankCm],
  };
}

/** The drawn box of a part, measured live: three 187 draws no getBoundingBox. */
function boxOf(obj) {
  return new THREE.Box3().setFromObject(obj);
}

/** Every point a drilled hole of radius R occupies: the centreline, the surface
 * circle at each station, both end caps and the bend corners - where a real drill
 * most easily breaks out of the iron it was meant to stay inside. */
function tubePoints(path, R, step = 0.1) {
  const pts = [];
  const nrm = (d) => {
    const n = Math.hypot(...d);
    return [d[0] / n, d[1] / n, d[2] / n];
  };
  const add = (p) => pts.push([p[0], p[1], p[2]]);
  const circle = (c, d, t) => {
    const a0 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = nrm([d[1] * a0[2] - d[2] * a0[1], d[2] * a0[0] - d[0] * a0[2], d[0] * a0[1] - d[1] * a0[0]]);
    const v = nrm([d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]);
    for (let i = 0; i < 12; i++) {
      const th = (i * Math.PI) / 6;
      const ct = Math.cos(th), st = Math.sin(th);
      add([c[0] + R * (ct * u[0] + st * v[0]), c[1] + R * (ct * u[1] + st * v[1]), c[2] + R * (ct * u[2] + st * v[2])]);
    }
    add([c[0] + R * d[0] * t, c[1] + R * d[1] * t, c[2] + R * d[2] * t]);
  };
  for (let i = 0; i + 1 < path.length; i++) {
    const [p0, p1] = [path[i], path[i + 1]];
    const d = nrm([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const n = Math.max(2, Math.ceil(len / step));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const c = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t];
      add(c);
      circle(c, d, k === n ? 1 : -1);
    }
  }
  return pts;
}

/** Prove one published bore against the drawn iron, allowing only the names the
 * route itself publishes. Returns the offending `state:name` counts, or null. */
function boreOffenders(oracle, path, R, allow = {}) {
  const seen = new Map();
  for (const p of tubePoints(path, R)) {
    const c = oracle.classify(p);
    const okState = c.state === 'iron' || allow[c.state] === true
      || (Array.isArray(allow[c.state]) && allow[c.state].includes(c.name));
    if (!okState) {
      const key = `${c.state}:${c.name ?? ''}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  return seen.size ? [...seen].map(([k, n]) => `${k} x${n}`) : [];
}

// ---------------------------------------------------------------------------
test('oil: the pump, the pan pickup and the pressure gauge sit in the sump each variant bolts on', async () => {
  const o = await O();
  for (const id of ['dohc', 'ohv']) {
    const net = o.oilNetwork(id);
    const P = panPlanes(id);
    const blk = blockOf(id);
    const pan = boxOf(partOf(blk, 'oil-pan'));

    // the pickup screen hangs in the sump, below the bolt flange, clear of the floor
    const scr = net.pickup.screen;
    assert.ok(scr[2] < P.flangeZ - 0.1 && scr[2] > P.panBottomZ + 0.15,
      `${id}: pickup screen at z ${scr[2].toFixed(4)} is not inside the sump ${P.panBottomZ}..${P.flangeZ}`);
    assert.ok(Math.abs(scr[1]) <= P.wallHalfY, `${id}: pickup screen at y ${scr[1].toFixed(4)} leaves the pan wall ${P.wallHalfY}`);
    assert.ok(scr[0] > pan.min.x + 0.5 && scr[0] < pan.max.x - 0.5,
      `${id}: pickup screen x ${scr[0].toFixed(4)} is outside the drawn pan ${pan.min.x}..${pan.max.x}`);

    // the pump stands OUTSIDE that wall and is joined to the pickup by its stem
    assert.ok(Math.abs(net.pump.body[1]) >= P.wallHalfY + net.pump.r,
      `${id}: the pump body at y ${net.pump.body[1].toFixed(4)} is inside the pan wall ${P.wallHalfY}`);
    assert.deepEqual(net.pump.inlet, net.pickup.stem, `${id}: the pump is not joined to the pickup stem`);

    // the gauge reads at the gallery it pumps into, and every node names a part
    assert.deepEqual(net.gauge.at, [net.galleries[0].x0 + 0.5, net.galleries[0].y, net.galleries[0].z],
      `${id}: the gauge does not read on the main gallery`);
    for (const n of [net.pump, net.pickup, net.gauge, ...net.galleries]) {
      assert.ok(typeof n.part === 'string' && n.part.startsWith('oil-'), `${id}: node ${n.id} draws no oil- part`);
    }
    assert.equal(net.variant, id, `${id}: the network reported variant ${net.variant}`);
  }
});

test('oil: the main gallery is bored in the crankcase wall band and leaves the published housing wall on both sides', async () => {
  const o = await O();
  for (const id of ['dohc', 'ohv']) {
    const net = o.oilNetwork(id);
    const s = o.oilSpec(id);
    const blk = blockOf(id);

    // published derivation, not a typed number
    assert.equal(s.galleryR, (OD - ID) / 2 - WALL, `${id}: gallery radius is not (OD-ID)/2 - housingWall`);
    assert.equal(s.wallMinCm, WALL, `${id}: the oil wall minimum is not the published SPEC.cam.bearing.housingWall`);
    assert.equal(s.galleryMidR, MID_R, `${id}: the gallery does not sit on the wall band mid radius`);
    assert.equal(net.galleries.every((g) => g.r === s.galleryR), true, `${id}: a gallery has another radius`);

    // the carriers the gallery has to underlie are the ones the block draws
    const carriers = ['main-bush-fore', 'main-bush-aft'].concat(MAIN_CAPS_X.map((c) => `main-shell-x${c}`))
      .map((n) => boxOf(partOf(blk, n)));
    const reach = Math.max(...carriers.map((b) => Math.max(Math.abs(b.min.x), Math.abs(b.max.x))));

    for (const g of net.galleries) {
      const r = Math.hypot(g.y, g.z);
      assert.ok(Math.abs(r - MID_R) < EPS, `${id}: gallery ${g.id} sits at radius ${r.toFixed(4)}, not ${MID_R}`);
      const inner = r - g.r - ID;
      const outer = OD - (r + g.r);
      assert.ok(inner >= WALL - EPS && outer >= WALL - EPS,
        `${id}: gallery ${g.id} leaves iron ${inner.toFixed(4)} inboard and ${outer.toFixed(4)} outboard, both must be >= ${WALL}`);
      // it runs long enough to reach past every drawn main carrier
      assert.ok(g.x0 <= -reach + EPS && g.x1 >= reach - EPS,
        `${id}: gallery ${g.id} spans ${g.x0}..${g.x1}, too short for the drawn main carriers at x +/-${reach.toFixed(2)}`);
      const bd = boxOf(blk);
      assert.ok(g.x0 >= bd.min.x && g.x1 <= bd.max.x,
        `${id}: gallery ${g.id} runs outside the drawn block ${bd.min.x}..${bd.max.x}`);
    }
    // DOHC bored one gallery straight down; OHV bores one per bank side at the
    // tunnel crown plane, because that is where its iron is - but the drawn casting
    // bridges neither side to the other (issue #28), so only one of them is filled
    // by the pump and the other stands here as a named pending clause.
    const pendingG = net.pendingGalleries ?? [];
    assert.equal(net.galleries.length + pendingG.length, id === 'dohc' ? 1 : 2,
      `${id}: ${net.galleries.length} bored main galleries, ${id === 'dohc' ? '1 expected' : '2 expected'}`);
    assert.equal(net.galleries.length, 1, `${id}: more than one main gallery is filled by the pump`);
    assert.deepEqual(pendingG.map((g) => g.issue), id === 'dohc' ? [] : ['#28'],
      `${id}: the unfilled gallery is not named as pending on issue #28`);
    if (id === 'dohc') assert.equal(Math.abs(net.galleries[0].y) < EPS, true, 'the DOHC gallery is not on the engine centre line');
    else for (const g of net.galleries) {
      assert.equal(Math.abs(g.z - ohvIron().crownZ) < EPS, true, `the OHV gallery is not on the tunnel crown plane ${ohvIron().crownZ}`);
      assert.ok(g.y > ohvIron().H.skirtHalfY, `the fed OHV gallery at y ${g.y} is not outboard of the skirt flank ${ohvIron().H.skirtHalfY}`);
    }
  }
});

test('oil: every main bearing is fed from the gallery and the feed ends on its drawn bearing shell', async () => {
  const o = await O();
  for (const id of ['dohc', 'ohv']) {
    const net = o.oilNetwork(id);
    const blk = blockOf(id);
    const feeds = net.feeds.filter((f) => f.kind === 'main');
    const pending = net.pendingMains ?? [];
    assert.deepEqual(pending.map((p) => p.x).sort((a, b) => b - a), id === 'dohc' ? [] : [24.25, -24.25],
      `${id}: the pending main clause is ${JSON.stringify(pending.map((p) => p.x))}; the drawn iron isolates ${id === 'ohv' ? 'x 24.25 and x -24.25 (issue #28)' : 'no main'}`);
    assert.equal(feeds.length + pending.length, MAIN_CAPS_X.length,
      `${id}: ${feeds.length} main feeds plus ${pending.length} pending for ${MAIN_CAPS_X.length} mains at ${MAIN_CAPS_X.join(',')}`);
    for (const p of pending) {
      assert.equal(p.issue, '#28', `${id}: the pending main at x ${p.x} is not named on issue #28`);
      assert.ok(partOf(blk, p.part), `${id}: the pending main names ${p.part}, which the block does not draw`);
    }

    for (const c of MAIN_CAPS_X) {
      const name = `main-shell-x${c}`;
      const band = radialBand(blk, name);
      assert.equal(Math.abs(band.hi - SHELL_OUT) < EPS, true, `${name} drawn band reaches ${band.hi}, not ${SHELL_OUT}`);
      assert.equal(Math.abs(band.lo - SHELL_IN) < EPS, true, `${name} drawn bore is ${band.lo}, not ${SHELL_IN}`);

      const feed = feeds.find((f) => f.x === c);
      if (!feed) {
        assert.ok(pending.some((p) => p.x === c), `${id}: main bearing ${name} has neither a feed drilling nor a pending clause`);
        continue;
      }
      const last = feed.path.at(-1);
      const r = Math.hypot(last[1], last[2]);
      assert.ok(Math.abs(r - SHELL_OUT) < EPS, `${name}: feed ends at radius ${r.toFixed(4)}, not on the shell at ${SHELL_OUT}`);
      assert.ok(last[0] >= band.x.min.x - EPS && last[0] <= band.x.max.x + EPS,
        `${name}: feed ends at x ${last[0]}, outside the shell band ${band.x.min.x}..${band.x.max.x}`);
      // it starts on a gallery bore
      const first = feed.path[0];
      const g = net.galleries.find((q) => q.id === feed.gallery);
      assert.ok(g, `${name}: feed names gallery ${feed.gallery}, which is not one of the bored galleries`);
      assert.ok(Math.abs(offAxis(first, [0, 0, 0], [1, 0, 0]) - (Math.hypot(g.y, g.z))) < g.r + EPS,
        `${name}: feed does not start on gallery ${g.id}`);
      assert.equal(feed.drillR, o.oilSpec(id).feedDrillR, `${name}: the feed hole radius is not the published drilling`);
    }
  }
});

test('oil: every rod bearing is fed through the crank from the main journal its big end rides on', async () => {
  const o = await O();
  for (const id of ['dohc', 'ohv']) {
    const net = o.oilNetwork(id);
    const ct = posed(createCranktrain(mats()).group);
    const feeds = net.feeds.filter((f) => f.kind === 'rod');
    assert.equal(feeds.length, SPEC.cylinders.length,
      `${id}: ${feeds.length} rod feeds for ${SPEC.cylinders.length} rods`);

    for (const cyl of SPEC.cylinders) {
      const s = B.stations[cyl.station];
      const feed = feeds.find((f) => f.cyl === cyl.num);
      assert.ok(feed, `${id}: rod ${cyl.num} at station ${s} has no feed drilling`);
      assert.equal(feed.throughCrank, true, `rod ${cyl.num}: its feed does not run through the crank`);

      const pin = boxOf(partOf(ct, `pin-s${s}`));
      const centre = pin.getCenter(new THREE.Vector3());
      // the pin's own AXIS stands at the crank throw: a through-crank way is bored
      // in that throw, which is what the rod feed follows
      const off = Math.hypot(centre.y, centre.z);
      assert.ok(Math.abs(off - CR.radius) < EPS, `pin-s${s} axis is at radius ${off.toFixed(4)} off the crank axis, not the ${CR.radius} cm throw`);

      const start = feed.path[0];
      const last = feed.path.at(-1);
      // out of a main journal on the crank axis, at a published main station
      assert.ok(Math.hypot(start[1], start[2]) < EPS, `rod ${cyl.num}: the feed does not start on the crank axis`);
      assert.ok(MAIN_CAPS_X.includes(start[0]), `rod ${cyl.num}: the feed starts at x ${start[0]}, which is not a main station`);
      // the main that carries it is the published one a half cylinder pitch away
      assert.ok(Math.abs(start[0] - s) <= B.pitch / 2 + EPS,
        `rod ${cyl.num}: main ${start[0]} stands more than half the ${B.pitch} cm cylinder pitch from its big end at station ${s}`);
      // and ends in the rod bore, in the film over the pin
      const d = Math.hypot(last[0] - centre.x, last[1] - centre.y, last[2] - centre.z);
      assert.ok(d >= CR.pinRadius - EPS && d <= ROD_BORE_IN + EPS,
        `rod ${cyl.num}: the feed ends ${d.toFixed(4)} from the pin axis, outside the ${CR.pinRadius}..${ROD_BORE_IN} bore`);
      // the whole drill stays inside the crank's own radial footprint: a through-
      // crank way is bored in the throw, it may not reach past the throw it feeds
      const far = Math.max(...feed.path.map((p) => Math.hypot(p[1], p[2])));
      assert.ok(far <= CR.radius + EPS,
        `rod ${cyl.num}: the through-crank drill runs ${far.toFixed(4)} from the crank axis, past the ${CR.radius} cm throw it is bored in`);
      // the drawn rod big-end bore is the film this feed fills, about its own pin axis
      const band = radialBand(ct, `rod-cyl${cyl.num}-big`, [centre.y, centre.z]);
      assert.ok(Math.abs(band.lo - ROD_BORE_IN) < EPS, `rod-cyl${cyl.num}-big drawn bore ${band.lo} is not ${ROD_BORE_IN}`);
    }
  }
});

test('oil: every DOHC cam bearing - 4 camshafts x 7 journals - is fed from a gallery to its line bore', async () => {
  const o = await O();
  const net = o.oilNetwork('dohc');
  const drawn = drawnCamBearings();
  const groups = camGroupNames('dohc');
  assert.equal(groups.length, 4, `DOHC draws ${groups.length} cam groups: ${groups.join(',')}`);
  const want = groups.flatMap((g) => CAM.bearings.map((x) => `${g}@${x}`));
  assert.equal(want.length, 28, 'the DOHC cam bearing census is not 4 x 7');
  for (const key of want) assert.ok(drawn.has(key), `the heads draw no cam bearing shell for ${key}`);

  const feeds = net.feeds.filter((f) => f.kind === 'cam');
  assert.equal(feeds.length, want.length, `DOHC has ${feeds.length} cam feeds for ${want.length} cam bearings`);
  for (const key of want) {
    const [group, xStr] = key.split('@');
    const x = Number(xStr);
    const feed = feeds.find((f) => f.group === group && f.x === x);
    assert.ok(feed, `cam bearing ${key} has no feed drilling`);
    const last = feed.path.at(-1);
    const axis = camJournalWorld(group, x);
    const dir = [1, 0, 0];
    const off = offAxis(last, axis, dir);
    assert.ok(Math.abs(off - CAM.bearingR) < EPS,
      `cam bearing ${key}: the feed ends ${off.toFixed(4)} from the cam axis, not at the line bore ${CAM.bearingR}`);
    assert.ok(Math.abs(last[0] - x) <= CAM.bearingHalf + EPS,
      `cam bearing ${key}: the feed arrives at x ${last[0]}, outside the ${CAM.bearingHalf} cm bearing width`);
    assert.equal(feed.gallery.startsWith('oil-gallery'), true, `cam feed ${feed.id} is not bored from a published gallery`);
    assert.ok(net.galleries.concat(net.camGalleries).some((g) => g.id === feed.gallery),
      `cam feed ${feed.id} names ${feed.gallery}, which is not a bored gallery`);
  }
  assert.equal(net.camGalleries.length, groups.length,
    `DOHC runs ${net.camGalleries.length} cam galleries for ${groups.length} camshafts`);
  for (const g of net.camGalleries) assert.ok(want.some((k) => k.startsWith(`${g.group}@`)), `cam gallery ${g.id} belongs to no drawn camshaft`);

  // Every rail gallery sits on the drawn rail it fills: the mid of the band the head
  // machines at SPEC.head.railTopA, at the mid of the gasket rail offset.
  for (const g of net.camGalleries) {
    const [, O] = camAxisBank(g.bank, g.valve);
    assert.ok(Math.abs(g.along - RAIL_BAND) < EPS, `cam gallery ${g.id} runs at along ${g.along}, not the drawn rail band mid ${RAIL_BAND}`);
    assert.ok(Math.abs(Math.abs(g.out) - RAIL_OUT) < EPS, `cam gallery ${g.id} runs at out ${g.out}, not the drawn deck rail mid ${RAIL_OUT}`);
    assert.equal(Math.sign(g.out), Math.sign(O), `cam gallery ${g.id} is not on the flank its camshaft stands on`);
    assert.ok(Math.abs(g.x0 + 27.5) < EPS && Math.abs(g.x1 - 27.5) < EPS, `cam gallery ${g.id} spans ${g.x0}..${g.x1}, not the drawn rail ${-27.5}..${27.5}`);
    const feed = feeds.find((f) => f.gallery === g.id);
    if (feed) {
      const [fx, fy, fz] = feed.path[0];
      const q = { x: fx, a: fy * bankUp(g.bank)[1] + fz * bankUp(g.bank)[2], o: fy * bankOut(g.bank)[1] + fz * bankOut(g.bank)[2] };
      assert.ok(Math.abs(q.a - RAIL_BAND) < EPS && Math.abs(Math.abs(q.o) - RAIL_OUT) < EPS,
        `cam feed ${feed.id} starts at bank (${q.a.toFixed(3)},${q.o.toFixed(3)}), not on its rail gallery ${g.id}`);
    }
  }

  // The two inboard rails have no block-side route at all: no wall-band arc reaches an
  // inboard flank without plowing a press-fit liner (tmp/8d-linkdir.out), so they are
  // filled through the head's chimney iron, fore and aft, bored at the machined rail
  // plane (tmp/8d-bridge.out, tmp/8d-cross.out).
  const bridges = net.bridges ?? [];
  assert.equal(bridges.length, 4, `DOHC runs ${bridges.length} head chimney crossings; the drawn iron needs 2 inboard rails x fore/aft`);
  for (const b of bridges) {
    const fed = net.camGalleries.find((g) => g.id === b.gallery);
    const src = net.camGalleries.find((g) => g.id === b.from);
    assert.ok(fed, `bridge ${b.id} feeds ${b.gallery}, which is no cam gallery`);
    assert.ok(src, `bridge ${b.id} drinks from ${b.from}, which is no cam gallery`);
    assert.equal(fed.bank, src.bank, `bridge ${b.id} crosses from bank ${src.bank} to ${fed.bank}`);
    assert.notEqual(Math.sign(fed.out), Math.sign(src.out), `bridge ${b.id} does not cross the head from its outboard to its inboard rail`);
    assert.ok(Math.abs(b.along - HEAD.railTopA) < EPS, `bridge ${b.id} is bored at along ${b.along}, not the machined rail plane ${HEAD.railTopA}`);
    assert.ok(Math.abs(b.x) >= 22 - EPS, `bridge ${b.id} stands at x ${b.x}, where a cylinder bore is (tmp/8d-cross.out)`);
    assert.equal(b.valve, fed.valve, `bridge ${b.id} feeds ${fed.valve} but is filed under ${b.valve}`);
    assert.equal(bridges.filter((k) => k.gallery === b.gallery).length, 2, `cam gallery ${b.gallery} is crossed at ${bridges.filter((k) => k.gallery === b.gallery).length} stations, not fore and aft`);
  }
  // each rail is filled by exactly one kind of route: a block leg on the outboard flank
  const fillers = (net.links ?? []).concat(bridges);
  assert.equal((net.links ?? []).length, 8, `DOHC runs ${net.links?.length ?? 0} block->head legs; the drawn iron allows 8 outboard columns and no inboard one`);
  for (const g of net.camGalleries) {
    const feeders = fillers.filter((l) => l.gallery === g.id);
    assert.equal(feeders.length > 0, true, `cam gallery ${g.id} has no filling route from the pump`);
    // the flank the block's wall band can reach is the one bankOut points at, i.e.
    // bank-frame out > 0; the inboard flank stands in the arc the bore tunnels block
    const outboard = Math.sign(g.out) === 1;
    const kinds = [...new Set(feeders.map((l) => l.kind))];
    const allowed = outboard ? ['link'] : ['bridge'];
    assert.deepEqual(kinds, allowed, `cam gallery ${g.id} (${outboard ? 'outboard' : 'inboard'}) is filled by ${kinds.join(',')} where the drawn iron allows only ${allowed.join(',')}`);
  }
});

test('oil: the OHV cam is fed at all 5 tunnel bushings and every feed pierces the published tunnel wall', async () => {
  const o = await O();
  const net = o.oilNetwork('ohv');
  const G = ohvBearings();
  const H = ohvIron().H;
  const blk = blockOf('ohv');
  const feeds = net.feeds.filter((f) => f.kind === 'cam');
  assert.equal(feeds.length, G.stations.length, `OHV has ${feeds.length} cam feeds for ${G.stations.length} tunnel bushings`);

  G.stations.forEach((x, i) => {
    const name = `cam-bushing-${i + 1}`;
    const band = radialBand(blk, name, [0, -H.belowCrankCm]);
    assert.ok(Math.abs(band.hi - G.boreR) < EPS && Math.abs(band.lo - G.shellIdR) < EPS,
      `${name} drawn band ${band.lo}..${band.hi} is not the published ${G.shellIdR}..${G.boreR}`);
    const feed = feeds.find((f) => f.x === x);
    assert.ok(feed, `OHV cam bearing at x ${x} (${name}) has no feed drilling`);
    const last = feed.path.at(-1);
    const off = offAxis(last, ohvIron().camAxis, [1, 0, 0]);
    assert.ok(Math.abs(off - G.boreR) < EPS, `${name}: feed ends at radius ${off.toFixed(4)}, not the bushing bore ${G.boreR}`);
    // the way in goes through the cast tunnel wall: 3.4..4.0 about the cam axis
    const wallPts = alongFeed(feed).filter((p) => offAxis(p, ohvIron().camAxis, [1, 0, 0]) <= H.tunnelWallR + EPS
      && offAxis(p, ohvIron().camAxis, [1, 0, 0]) >= H.tunnelBoreR - EPS);
    assert.ok(wallPts.length > 0, `${name}: its feed never crosses the machined tunnel wall ${H.tunnelBoreR}..${H.tunnelWallR}`);
    assert.ok(Math.abs(offAxis(feed.path[0], ohvIron().camAxis, [1, 0, 0]) - H.tunnelWallR) > STACK.castWall - EPS,
      `${name}: its feed starts inside the tunnel wall instead of in the iron beside it`);
  });
});

test('oil: every published bore is bored in iron and touches nothing it names wrongly - never the crankcase bore, a cylinder bore, a press-fit liner, the pan sump or the cam lobe air', async () => {
  const o = await O();
  const maxSweep = Math.max(...crankSwings().map((s) => s[1]));
  assert.ok(maxSweep < ID - WALL, `the swings ${maxSweep} would plow the gallery the wall band leaves no room for`);
  for (const id of ['dohc', 'ohv']) {
    const net = o.oilNetwork(id);
    const oracle = oilOracle(id);
    const bores = [net.supply, ...net.galleries, ...(net.camGalleries ?? []), ...(net.links ?? []),
      ...(net.bridges ?? []), ...net.feeds].filter(Boolean);
    assert.equal(bores.length > 10, true, `${id}: ${bores.length} published bores is not a network`);
    const bad = [];
    for (const b of bores) {
      assert.ok(Array.isArray(b.path) && b.path.length > 1, `${b.id}: a published bore with no drilling path`);
      assert.equal(typeof b.drillR, 'number', `${b.id}: a published bore with no drilling radius`);
      // An allow list names the part a route ends in, or the oil space it fills. A
      // void, open air, a cylinder bore, a press-fit liner or the pan sump is never
      // on one, because no drilling may be bored through them.
      const allow = b.allow ?? {};
      for (const state of ['void', 'air'])
        assert.equal(state in allow, false, `${b.id}: its allow list names ${state}, which no bore may run through`);
      assert.equal((allow.solid ?? []).some((n) => n.startsWith('liner-cyl')), false, `${b.id}: its allow list names a press-fit liner`);
      assert.equal((allow.oil ?? []).some((n) => n === 'oil-pan'), false, `${b.id}: its allow list names the pan sump`);
      // only a through-crank rod way may run in the crank's own metal, and only inside
      // the radial footprint of the throw it feeds
      if ('rotating' in allow) {
        assert.equal(b.kind, 'rod', `${b.id}: a ${b.kind} bore names the crank's own metal in its allow list`);
        const far = Math.max(...b.path.map((p) => Math.hypot(p[1], p[2])));
        assert.ok(far <= CR.radius + EPS, `${b.id}: its rotating allowance reaches ${far.toFixed(4)}, past the ${CR.radius} cm throw`);
      }
      const offenders = boreOffenders(oracle, b.path, b.drillR, allow);
      if (offenders.length) bad.push(`${b.id} (R ${b.drillR}): ${offenders.join(', ')}`);
    }
    assert.deepEqual(bad, [], `${id}: ${bad.length} published bores leave the iron they were drilled in:\n  ${bad.join('\n  ')}`);
  }
});

test('oil: the network is connected from the pump and no bearing in either variant is orphaned', async () => {
  const o = await O();
  for (const id of ['dohc', 'ohv']) {
    const net = o.oilNetwork(id);
    const seen = new Set(['oil-pump']);
    const ways = [net.supply, ...net.galleries, ...(net.camGalleries ?? []), ...(net.links ?? []),
      ...(net.bridges ?? []), ...net.feeds].filter(Boolean);
    let grew = true;
    while (grew) {
      grew = false;
      for (const w of ways) {
        const src = w.from ?? w.gallery;
        if (seen.has(src) && !seen.has(w.id)) { seen.add(w.id); grew = true; }
      }
    }
    const orphan = ways.filter((w) => !seen.has(w.id));
    assert.deepEqual(orphan.map((w) => `${w.kind ?? 'way'} ${w.id} <- ${w.from ?? w.gallery}`), [],
      `${id}: ${orphan.length} bored ways have no path back to the pump`);
    const galleries = net.galleries.concat(net.camGalleries ?? []);
    assert.deepEqual(galleries.filter((g) => !seen.has(g.id)).map((g) => g.id), [], `${id}: a gallery is not filled by the pump`);

    // every bearing the published positions name is fed exactly once
    const keys = new Set();
    for (const c of MAIN_CAPS_X) keys.add(`main@${c}`);
    for (const cyl of SPEC.cylinders) keys.add(`rod@${cyl.num}`);
    if (id === 'dohc') for (const g of camGroupNames(id)) for (const x of CAM.bearings) keys.add(`cam@${g}@${x}`);
    else for (const x of ohvBearings().stations) keys.add(`cam@${x}`);
    const bearingFeeds = net.feeds.filter((f) => ['main', 'rod', 'cam'].includes(f.kind));
    assert.equal(net.feeds.length, bearingFeeds.length, `${id}: a feed drilling feeds no bearing the published positions name`);
    const fed = bearingFeeds.map((f) => (f.kind === 'main' ? `main@${f.x}` : f.kind === 'rod' ? `rod@${f.cyl}` : (f.group ? `cam@${f.group}@${f.x}` : `cam@${f.x}`)));
    assert.equal(new Set(fed).size, fed.length, `${id}: a bearing is fed more than once`);
    const pendingMain = (net.pendingMains ?? []).map((p) => `main@${p.x}`);
    const wanted = [...keys].filter((k) => !pendingMain.includes(k)).sort();
    assert.deepEqual(wanted, [...new Set(fed)].sort(),
      `${id}: the fed bearings are not the ${wanted.length} bearings its published positions name (pending: ${pendingMain.join(',') || 'none'})`);
    assert.equal(o.provenance(id, fed[0]).at(0).id, 'oil-pump', `${id}: a feed does not trace back to the pump`);
  }
});

test('oil: every oil count is generated from the published position lists and matches the drawn hardware', async () => {
  const o = await O();
  for (const id of ['dohc', 'ohv']) {
    const net = o.oilNetwork(id);
    const cams = id === 'dohc' ? camGroupNames(id).length * CAM.bearings.length : ohvBearings().stations.length;
    const want = { mains: MAIN_CAPS_X.length, rods: SPEC.cylinders.length, cams };
    assert.deepEqual(net.counts, want, `${id}: counts ${JSON.stringify(net.counts)} are not the generated ${JSON.stringify(want)}`);
    assert.deepEqual(SPEC.oil.counts[id], want, `${id}: SPEC.oil.counts.${id} is not generated from the position lists`);
    // a bearing is either fed or named pending; there is no third state
    const pending = (net.pendingMains ?? []).length;
    assert.equal(net.feeds.length, want.mains + want.rods + want.cams - pending,
      `${id}: ${net.feeds.length} feed drillings for ${want.mains} mains + ${want.rods} rods + ${want.cams} cams less ${pending} named pending`);
  }
  // the numbers the row quotes are the drawn ones, measured live
  const drawn = drawnCamBearings();
  assert.equal(drawn.size, 28, `the heads draw ${drawn.size} cam bearings, not 28`);
  for (const id of ['dohc', 'ohv']) {
    const blk = blockOf(id);
    assert.equal(MAIN_CAPS_X.filter((c) => blk.getObjectByName(`main-shell-x${c}`)).length, 5, `${id}: fewer than 5 main shells are drawn`);
    assert.equal(blockOf('ohv').children.filter((o) => /^cam-bushing-\d+$/.test(o.name)).length, ohvBearings().stations.length,
      'the OHV block draws a different number of tunnel bushings than ohvBearings() publishes');
  }
});

test('oil: the OHV lifter gallery stays a named pending clause while slice 8C-3 is undecided', async () => {
  const o = await O();
  const net = o.oilNetwork('ohv');
  assert.equal(SPEC.variants.ohv.drawn, false, 'the OHV follower train is drawn: the pending clause has to be re-gated');
  assert.equal(net.lifterGallery.pending, '#16', 'the lifter gallery clause is not named as pending on issue #16');
  assert.equal(net.lifterGallery.feed, null, 'a lifter gallery feed exists while no lifter gallery is cast: 8C-3 has not landed');
  assert.equal(net.feeds.some((f) => f.kind === 'lifter'), false, 'a lifter feed is claimed with no lifters in the tree');
  assert.equal(o.oilSpec('ohv').pendingIssues.includes('#16'), true, 'SPEC.oil does not name issue #16 as the open clause');
});

test('oil: the DOHC build, its default variant and its published geometry are untouched by the oil system', async () => {
  const o = await O();
  assert.equal(SPEC.build.variant, 'dohc', 'SPEC.build.variant moved off dohc');
  assert.equal(o.oilNetwork().variant, 'dohc', 'the default network is not the built variant');
  const a = o.oilNetwork('dohc');
  const b = o.oilNetwork('dohc');
  assert.deepEqual(a.feeds.map((f) => [f.id, f.kind, f.drillR]), b.feeds.map((f) => [f.id, f.kind, f.drillR]),
    'the DOHC oil network is not deterministic across calls');
  // the iron the oil is bored in is the iron the block already draws
  const blk = blockOf('dohc');
  const bd = boxOf(blk);
  assert.ok(Math.abs(bd.max.x - 26.5) < EPS || Math.abs(bd.max.x - 27.4) < EPS, `the DOHC block's drawn extent moved to ${bd.max.x}`);
  // the drilled oil holes in the shells themselves are slice 8D-2 and are not in the
  // tree yet: the row names that open clause instead of pretending they are drawn
  assert.equal(o.oilSpec('dohc').pending.drawnHoles, '#8', `the drawn-oil-hole clause is ${JSON.stringify(o.oilSpec('dohc').pending.drawnHoles)}, not issue #8`);
  assert.equal(SPEC.oil.pendingIssues.includes('#8'), true, 'SPEC.oil does not name the drawn-hole clause');
  assert.equal(SPEC.oil.wallMinCm, STACK.housingWall, 'SPEC.oil typed a wall instead of reusing the published bearing wall');
});
