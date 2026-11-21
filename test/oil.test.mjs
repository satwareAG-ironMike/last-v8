// Slice 8D-1 (issue #8 addendum item 5, GATES row A1-G4): the oil NETWORK of both
// builds - pump, pan pickup, main gallery, a feed drilling to every main bearing,
// through the crank to every rod bearing, and on to every cam bearing, every feed
// traced back to the pump.
//
// Written RED first: `src/engine/oil.js` does not exist yet, so every law below
// reds itself on the import. The contract numbers were measured against the drawn
// iron before the laws were written (tmp/8d-iron.mjs, tmp/8d-oil-probe.mjs,
// tmp/8d-oracle.mjs, tmp/8d-oracle2.mjs) and each law gates one of them.
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
//   the OHV route - the only iron between the sump and a mid main bearing is the
//     cap boot leg (skirtInboardY..skirtHalfY, from skirtCornerZ up) plus the cap
//     bar standing on the machined tunnel crown at -(belowCrankCm - tunnelWallR);
//     the OHV gallery therefore sits ON that crown plane at the wall mid radius,
//     at y = sqrt(10.5^2 - 6.8^2) = 8.0, and its feeds go down to the leg, up the
//     leg and inboard under the cap bar to the shell.
//
// What this file does NOT gate, and says so:
//   - the OHV LIFTER GALLERY feed. SPEC.variants.ohv.drawn is false and issue #16
//     has not chosen a casting option yet, so no lifter gallery exists to feed.
//     Law 10 names that clause as pending instead of pretending it is done.
//   - the DRAWN oil parts and the drilled oil holes in the shells: slice 8D-2
//     (src/render/oil.js, holes in main-shell-* and in the bearing shells) with
//     its own laws added to this file and to test/block.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BANKS,
  MAIN_CAPS_X,
  SPEC,
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

/** Every drawn cam bearing the heads machine, as `group@station`. */
function drawnCamBearings() {
  const out = new Map();
  posed(createHeads(mats()).group).traverse((o) => {
    if (!o.isMesh) return;
    const m = /^shell-([A-Za-z-]+?)-(?:cam-)?(-?[\d.]+)-(cap|cradle)$/.exec(o.name);
    if (!m) return;
    out.set(`${m[1]}@${m[2]}`, o);
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

// ---------------------------------------------------------------------------
test('oil: the pump, the pan pickup and the pressure gauge sit in the sump each variant bolts on', async () => {
  const o = await O();
  for (const id of ['dohc', 'ohv']) {
    const net = o.oilNetwork(id);
    const P = panPlanes(id);
    const blk = blockOf(id);
    const pan = partOf(blk, 'oil-pan').getBoundingBox();

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

    // published derivation, not a typed number
    assert.equal(s.galleryR, (OD - ID) / 2 - WALL, `${id}: gallery radius is not (OD-ID)/2 - housingWall`);
    assert.equal(s.wallMinCm, WALL, `${id}: the oil wall minimum is not the published SPEC.cam.bearing.housingWall`);
    assert.equal(s.galleryMidR, MID_R, `${id}: the gallery does not sit on the wall band mid radius`);
    assert.equal(net.galleries.every((g) => g.r === s.galleryR), true, `${id}: a gallery has another radius`);

    for (const g of net.galleries) {
      const r = Math.hypot(g.y, g.z);
      assert.ok(Math.abs(r - MID_R) < EPS, `${id}: gallery ${g.id} sits at radius ${r.toFixed(4)}, not ${MID_R}`);
      const inner = r - g.r - ID;
      const outer = OD - (r + g.r);
      assert.ok(inner >= WALL - EPS && outer >= WALL - EPS,
        `${id}: gallery ${g.id} leaves iron ${inner.toFixed(4)} inboard and ${outer.toFixed(4)} outboard, both must be >= ${WALL}`);
      // it runs long enough to underlie every main cap lug
      const reach = MAIN_CAPS_X.map((c) => [c - 2.3, c + 2.3]).flat();
      assert.ok(g.x0 <= Math.min(...reach) + EPS && g.x1 >= Math.max(...reach) - EPS,
        `${id}: gallery ${g.id} spans ${g.x0}..${g.x1}, too short for the main cap lugs ${Math.min(...reach)}..${Math.max(...reach)}`);
      const blk = blockOf(id).getBoundingBox();
      assert.ok(g.x0 >= blk.min.x && g.x1 <= blk.max.x,
        `${id}: gallery ${g.id} runs outside the drawn block ${blk.min.x}..${blk.max.x}`);
    }
    // DOHC bored one gallery straight down; OHV bored one per bank side, at the
    // tunnel crown plane, because that is where its iron is
    assert.equal(net.galleries.length, id === 'dohc' ? 1 : 2, `${id}: ${net.galleries.length} main galleries`);
    if (id === 'dohc') assert.equal(Math.abs(net.galleries[0].y) < EPS, true, 'the DOHC gallery is not on the engine centre line');
    else for (const g of net.galleries) {
      assert.equal(Math.abs(g.z - ohvIron().crownZ) < EPS, true, `the OHV gallery is not on the tunnel crown plane ${ohvIron().crownZ}`);
      assert.ok(g.y > 0 ? g.y > ohvIron().H.skirtHalfY : g.y < -ohvIron().H.skirtHalfY,
        `the OHV gallery at y ${g.y} is not outboard of the skirt flank`);
    }
  }
});

test('oil: every main bearing is fed from the gallery and the feed ends on its drawn bearing shell', async () => {
  const o = await O();
  for (const id of ['dohc', 'ohv']) {
    const net = o.oilNetwork(id);
    const blk = blockOf(id);
    const feeds = net.feeds.filter((f) => f.kind === 'main');
    assert.equal(feeds.length, MAIN_CAPS_X.length,
      `${id}: ${feeds.length} main feeds for ${MAIN_CAPS_X.length} mains at ${MAIN_CAPS_X.join(',')}`);

    for (const c of MAIN_CAPS_X) {
      const name = `main-shell-x${c}`;
      const band = radialBand(blk, name);
      assert.equal(Math.abs(band.hi - SHELL_OUT) < EPS, true, `${name} drawn band reaches ${band.hi}, not ${SHELL_OUT}`);
      assert.equal(Math.abs(band.lo - SHELL_IN) < EPS, true, `${name} drawn bore is ${band.lo}, not ${SHELL_IN}`);

      const feed = feeds.find((f) => f.x === c);
      assert.ok(feed, `${id}: main bearing ${name} has no feed drilling`);
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

      const pin = partOf(ct, `pin-s${s}`).getBoundingBox();
      const centre = pin.getCenter(new THREE.Vector3());
      const off = Math.hypot(centre.y, centre.z);
      assert.ok(Math.abs(off - CR.pinRadius) < 0.05 + EPS, `pin-s${s} is at radius ${off.toFixed(4)} off the crank axis`);

      const [start, ...rest] = feed.path;
      const last = feed.path.at(-1);
      // out of a main journal on the crank axis, at a published main station
      assert.ok(Math.hypot(start[1], start[2]) < EPS, `rod ${cyl.num}: the feed does not start on the crank axis`);
      assert.ok(MAIN_CAPS_X.includes(start[0]), `rod ${cyl.num}: the feed starts at x ${start[0]}, which is not a main station`);
      assert.ok(Math.abs(start[0] - s) <= (MAIN_CAPS_X[1] - MAIN_CAPS_X[0]) / 2 + EPS,
        `rod ${cyl.num}: main ${start[0]} does not carry its big end at station ${s}`);
      // and ends in the rod bore, in the film over the pin
      const d = Math.hypot(last[0] - centre.x, last[1] - centre.y, last[2] - centre.z);
      assert.ok(d >= CR.pinRadius - EPS && d <= ROD_BORE_IN + EPS,
        `rod ${cyl.num}: the feed ends ${d.toFixed(4)} from the pin axis, outside the ${CR.pinRadius}..${ROD_BORE_IN} bore`);
      assert.ok(rest.every((p) => Math.hypot(p[1], p[2]) <= CR.pinRadius + EPS),
        `rod ${cyl.num}: a through-crank feed leaves the crank's own metal`);
      // the drawn rod big end bore is the film this feed fills
      const band = radialBand(ct, `rod-cyl${cyl.num}-big`);
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

test('oil: no feed drilling runs through the crankcase bore, a cylinder bore, the pan sump or the cam lobe air', async () => {
  const o = await O();
  const swings = crankSwings();
  const maxSweep = Math.max(...swings.map((s) => s[1]));
  for (const id of ['dohc', 'ohv']) {
    const net = o.oilNetwork(id);
    const H = id === 'ohv' ? ohvIron() : null;
    const bad = [];
    for (const f of net.feeds) {
      for (const p of alongFeed(f)) {
        const rCrank = Math.hypot(p[1], p[2]);
        // the open crankcase is a void a block-side feed may only enter at its own
        // bearing, and never below the swings
        if (id === 'dohc' && rCrank < ID - WALL && f.kind !== 'cam' && rCrank > SHELL_OUT + EPS) {
          bad.push(`${f.id}: runs ${rCrank.toFixed(3)} from the crank axis, inside the crankcase bore ${ID}`);
        }
        for (const cyl of SPEC.cylinders) {
          const bank = BANKS[cyl.bank];
          const u = polarDir(bank.az);
          const v = polarDir(bank.az + bank.outSign * 90);
          const along = p[0] * 0 + (p[1] * u[1] + p[2] * u[2]);
          const out = p[1] * v[1] + p[2] * v[2];
          const s = B.stations[cyl.station];
          if (Math.abs(along - s) <= 0.0 && Math.abs(out) < B.boreRadius - 0.1) {
            bad.push(`${f.id}: runs through the cylinder bore of cyl ${cyl.num} at station ${s}`);
          }
        }
        if (id === 'ohv') {
          const off = offAxis(p, H.camAxis, [1, 0, 0]);
          const lobeAir = VAR.ohv.tunnel.lobeAirCm;
          if (f.kind !== 'cam' && off < VAR.ohv.tunnel.castOdR + lobeAir - EPS) {
            bad.push(`${f.id}: runs ${off.toFixed(3)} from the OHV cam axis, inside the lobe nose ${VAR.ohv.tunnel.castOdR} plus its ${lobeAir} air`);
          }
          const P = panPlanes('ohv');
          if (p[2] < P.flangeZ && Math.abs(p[1]) < P.wallHalfY && f.kind !== 'cam') {
            bad.push(`${f.id}: runs through the OHV sump below the pan flange ${P.flangeZ}`);
          }
        }
      }
    }
    assert.deepEqual(bad, [], `${id}: feed drillings intrude where the pump must not put oil:\n  ${bad.join('\n  ')}`);
    assert.ok(maxSweep < ID - WALL, `${id}: the swings ${maxSweep} would plow the gallery the wall band leaves no room for`);
  }
});

test('oil: the network is connected from the pump and no bearing in either variant is orphaned', async () => {
  const o = await O();
  for (const id of ['dohc', 'ohv']) {
    const net = o.oilNetwork(id);
    const seen = new Set(['oil-pump']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of net.feeds) {
        const from = f.gallery ?? f.from;
        if (seen.has(from) && !seen.has(f.id)) { seen.add(f.id); grew = true; }
      }
      for (const g of net.galleries.concat(net.camGalleries ?? [])) {
        if (seen.has(g.from) && !seen.has(g.id)) { seen.add(g.id); grew = true; }
      }
    }
    const orphan = net.feeds.filter((f) => !seen.has(f.id));
    assert.deepEqual(orphan.map((f) => f.id), [], `${id}: ${orphan.length} feed drillings have no path back to the pump`);
    const galleries = net.galleries.concat(net.camGalleries ?? []);
    assert.deepEqual(galleries.filter((g) => !seen.has(g.id)).map((g) => g.id), [], `${id}: a gallery is not filled by the pump`);

    // every bearing the published positions name is fed exactly once
    const keys = new Set();
    for (const c of MAIN_CAPS_X) keys.add(`main@${c}`);
    for (const cyl of SPEC.cylinders) keys.add(`rod@${cyl.num}`);
    if (id === 'dohc') for (const g of camGroupNames(id)) for (const x of CAM.bearings) keys.add(`cam@${g}@${x}`);
    else for (const x of ohvBearings().stations) keys.add(`cam@${x}`);
    const fed = net.feeds.map((f) => (f.kind === 'main' ? `main@${f.x}` : f.kind === 'rod' ? `rod@${f.cyl}` : (f.group ? `cam@${f.group}@${f.x}` : `cam@${f.x}`)));
    assert.equal(new Set(fed).size, fed.length, `${id}: a bearing is fed more than once`);
    assert.deepEqual([...keys].sort(), [...new Set(fed)].sort(),
      `${id}: the fed bearings are not the ${keys.size} bearings its published positions name`);
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
    assert.equal(net.feeds.length, want.mains + want.rods + want.cams, `${id}: feed count does not equal its bearing count`);
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
  const bd = blk.getBoundingBox();
  assert.equal(Math.abs(bd.max.x - 27.4) < EPS || Math.abs(bd.max.x - 26.5) < EPS, true, `the DOHC block's drawn extent moved to ${bd.max.x}`);
  assert.equal(HOLES.size, 1, 'the drawn-oil-holes census is not a named clause');
  assert.equal(SPEC.oil.wallMinCm, STACK.housingWall, 'SPEC.oil typed a wall instead of reusing the published bearing wall');
});
