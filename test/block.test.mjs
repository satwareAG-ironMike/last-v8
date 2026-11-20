// Block casting topology: every decomposed solid must mate exactly with the
// crankcase drum (no floating parts) and every junction point is pure math.
// The renderer (src/render/block.js) builds these solids from these helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEC,
  OD,
  ID,
  arcHalfDepth,
  arcHalfWidth,
  idHalfDepth,
  supportColumn,
  mainCapLug,
  MAIN_CAPS_X,
  panFlangeHalfWidth,
  bankPoint,
} from '../src/engine/spec.js';
import { housingInRel, housingOutRel } from '../src/engine/bearings.js';

const B = SPEC.block;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('design dimensions are the pinned real-world values', () => {
  assert.equal(OD, 11.6);
  assert.equal(ID, 9.4);
  assert.ok(near(arcHalfDepth(B.deckHalfWidth), 9.2499, 1e-3)); // column base chord depth
  assert.ok(near(idHalfDepth(B.boreWallHalf), 7.7297, 1e-3)); // web tangent at void wall
  assert.ok(near(panFlangeHalfWidth(11.15), 3.1996, 1e-3)); // pan flange half-width
  assert.deepEqual(MAIN_CAPS_X, [24.25, 11, 0, -11, -24.25]);
  assert.ok(near(B.deckA, 24.1) && near(B.boreStartA, 5.5) && near(B.pitch, 11));
  assert.equal(B.mainBossR, 4.6);
  assert.equal(B.aftMainBossR, 5.7);
  // crank counterweights swing only inside the drum bay, never near the end discs
  assert.equal(B.counterBayHalfX, B.stations[0] + B.pitch / 2);
  assert.ok(SPEC.crank.counterRadius < ID, 'counterweights must clear the drum shell');
});

test('chord helpers land exactly on the OD circle', () => {
  // deck-corner column base: out = deckHalfWidth on the OD
  const d = arcHalfDepth(B.deckHalfWidth);
  assert.ok(near(Math.hypot(d, B.deckHalfWidth), OD), `hypot=${Math.hypot(d, B.deckHalfWidth)} OD=${OD}`);
  // pan flange chord at z = -11.15 on the OD
  const w = arcHalfWidth(11.15);
  assert.ok(near(Math.hypot(w, 11.15), OD), `hypot=${Math.hypot(w, 11.15)}`);
});

test('support columns mate the OD and clear the crankcase void', () => {
  const col = supportColumn('L');
  assert.ok(near(col.rOuterBottom, OD), 'outer bottom corner must sit on the OD cylinder');
  // inner bottom corner must be inside the casting annulus, never in the void
  assert.ok(col.rInnerBottom > ID, `inner corner ${col.rInnerBottom} intrudes into the void`);
  assert.ok(col.rInnerBottom < OD, 'inner corner pokes out of the casting');
  assert.ok(near(col.along1, B.deckA), 'column top is the deck face');
  assert.ok(near(col.out1, B.deckHalfWidth), 'column outboard face is the deck edge');
  // bore tunnel wall must leave metal between liner OD and column inner face
  assert.ok(B.boreWallHalf > B.boreShellRadius, 'no wall metal between tunnel and column');
});

test('inboard webs bridge the banks with exact tangency at the void edge', () => {
  const aWeb = idHalfDepth(B.boreWallHalf); // where the web inner corner touches ID
  assert.ok(near(Math.hypot(aWeb, B.boreWallHalf), ID), 'web inner corner must ride the void wall');
  // the same bottom face, at the outboard corner, is embedded in the drum annulus
  const rOut = Math.hypot(aWeb, B.deckHalfWidth);
  assert.ok(rOut > ID && rOut < OD, `web outer corner r=${rOut} not embedded in casting`);
  // web reaches up to the deck on both banks (mirrored world corners)
  const pL = bankPoint('L', B.deckA, -B.deckHalfWidth);
  const pR = bankPoint('R', B.deckA, -B.deckHalfWidth);
  assert.ok(near(pL.y, -pR.y, 1e-9) && near(pL.z, pR.z, 1e-9), 'web deck corners must mirror');
  // deck corner world position: (deckA - deckHalfWidth)/sqrt2 for y/z pair
  assert.ok(near(pR.y * Math.SQRT2, B.deckA - B.deckHalfWidth, 1e-9));
  assert.ok(near(pR.z * Math.SQRT2, B.deckA + B.deckHalfWidth, 1e-9));
});

test('liner bottom is buried in the drum wall, not floating in the bay', () => {
  const a = idHalfDepth(B.boreShellRadius + 0.15); // liner OD slips 0.15 into the walls
  // just above the ID crossing the liner OD sits inside the casting annulus
  const r = Math.hypot(a + 0.5, B.boreShellRadius + 0.15);
  assert.ok(r > ID && r < OD, `liner embed point r=${r} not in annulus`);
  // liner top is flush with the deck
  assert.ok(near(B.deckA, SPEC.head.seatA), 'liner top must end at the deck/seat plane');
});

test('main caps ride the void wall and sit at slab joints and slab centres', () => {
  const lug = mainCapLug();
  assert.ok(near(lug.rCorner, ID, 0.02), `cap corner r=${lug.rCorner} must bear on the void wall`);
  assert.ok(lug.zBottom < -ID, 'cap must protrude below the void into the pan rail zone');
  assert.ok(lug.zBottom > -OD, 'cap must stay inside the casting OD envelope');
  // interior caps at the slab joints: station x minus half pitch
  for (let i = 0; i < 3; i++) {
    assert.equal(MAIN_CAPS_X[i + 1], B.stations[i] - B.pitch / 2, `cap ${i + 1} not at slab joint`);
  }
  // fore/aft caps: symmetric at +/-24.25, inside their fore/aft slabs
  const xFront = B.stations[0] + B.pitch / 2;
  const xRear = B.stations[3] - B.pitch / 2;
  assert.equal(MAIN_CAPS_X[0], xFront + B.slabFront / 2);
  assert.ok(MAIN_CAPS_X[4] < xRear && MAIN_CAPS_X[4] > xRear - B.slabRear, 'aft cap inside aft slab');
  // symmetric about x = 0
  assert.equal(MAIN_CAPS_X[0], -MAIN_CAPS_X[4]);
  assert.equal(MAIN_CAPS_X[1], -MAIN_CAPS_X[3]);
});

test('pan flange width is the OD chord at the bolt plane', () => {
  const w = panFlangeHalfWidth(11.15);
  assert.ok(near(Math.hypot(w, 11.15), OD));
  assert.ok(w < B.boreWallHalf, 'pan must be narrower than the bore walls');
  // pan rails (flat pads z -11.6..-11.15) embed into the drum along their length
  assert.ok(Math.hypot(1.5, 11.4) > ID && Math.hypot(1.5, 11.4) < OD, 'rail embed point not in annulus');
});

test('union sanity: every block solid family is anchored on the drum shell', () => {
  // drum shell x range equals station-slab x range; end discs close it
  const xFront = B.stations[0] + B.pitch / 2;
  const xRear = B.stations[3] - B.pitch / 2;
  assert.equal(xFront - xRear, 4 * B.pitch); // four station slabs
  assert.equal(xFront + B.slabFront, 26.5); // fore end face
  assert.equal(xRear - B.slabRear, -26.5); // aft end face
  // webs stand on the void wall at the tangent along-value the renderer uses
  assert.ok(idHalfDepth(B.boreWallHalf) < arcHalfDepth(B.boreWallHalf), 'web tangent is below column tangent');
});

test('renderer instantiation: block builds as one group inside the design envelope', async () => {
  const { createBlock } = await import('../src/render/block.js');
  const THREE = await import('three');
  const fakeMats = {};
  for (const name of ['castIronBlock', 'boreWall', 'bearingShell', 'fastenerDark', 'paintedGraphite', 'brass'])
    fakeMats[name] = new THREE.MeshStandardMaterial({ name });
  const block = createBlock(fakeMats);
  const meshes = [];
  block.traverse((o) => o.isMesh && meshes.push(o));
  assert.ok(meshes.length >= 45, `too few solids: ${meshes.length}`);
  const bb = new THREE.Box3().setFromObject(block);
  const E = { x: 26.5, y: 21.99, zLo: -15.05, zHi: 21.99 }; // deck corner: (deckA + deckHalfWidth)/sqrt2
  assert.ok(
    Math.abs(bb.min.x + E.x) < 0.2 && Math.abs(bb.max.x - E.x) < 0.2 &&
    Math.abs(bb.min.y + E.y) < 0.3 && Math.abs(bb.max.y - E.y) < 0.3 &&
    Math.abs(bb.min.z - E.zLo) < 0.3 && Math.abs(bb.max.z - E.zHi) < 0.35,
    `block bbox ${JSON.stringify([bb.min.x, bb.max.x, bb.min.y, bb.max.y, bb.min.z, bb.max.z])}`
  );
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i)))
        assert.fail(`${m.name}: NaN vertex`);
    }
  }
  // liners must sit at their own station x - one per bore, none stacked
  const wantX = { 1: 16.5, 2: 16.5, 3: 5.5, 4: 5.5, 5: -5.5, 6: -5.5, 7: -16.5, 8: -16.5 };
  for (const [num, want] of Object.entries(wantX)) {
    const liner = meshes.find((m) => m.name === `liner-cyl${num}`);
    assert.ok(liner, `liner-cyl${num} missing`);
    const lbb = new THREE.Box3().setFromObject(liner);
    const cx = (lbb.min.x + lbb.max.x) / 2;
    assert.ok(Math.abs(cx - want) < 0.01, `liner-cyl${num} at x=${cx}, must be ${want}`);
  }
});

// ---------------------------------------------------------------------------
// A1-G7 (issue #8 addendum item 4) / issue #16: an OHV cam has to be HOUSED in
// the block. This tree casts a round crankcase drum whose bottom tangent is the
// pan rail; a cam stood 10.8 cm below the crank centre sweeps its 3.10 cm nose
// 2.30 cm through that wall, and the tunnel floor it needs stands 2.60 cm below
// the drum. These laws gate the consequence tmp/ohvdrum.mjs measures: a variant
// casting that gives up the arc of its own wall the bored tunnel crosses, carries
// the machined tunnel floor on a cast skirt, bolts its pan on its own faces, and
// keeps every crank-side swing clear. All of it derived from published walls.
// ---------------------------------------------------------------------------

const OHV_CAST = 'A1-G7/issue #16 the OHV casting houses its cam';
// drawn geometry is stored in Float32 attributes, so a Box3 read off a mesh can
// only be held to the resolution of that attribute (measured 1.9e-7 on the
// DOHC casting bottom); a named eps, not a silent widening of the math asserts
const GEOM_EPS = 1e-6;
// The DOHC casting as the tree drew it BEFORE any OHV geometry existed: read off
// the tree at d102c63 (the four OHV laws committed, none of the src changes),
// with tmp/baseline-census.mjs running that tree's own src/render/block.js. This
// is what "the shipped casting stayed exactly the same" is measured against, so
// the claim below is a reading and not a restatement of the drawing.
// READ_EPS: a Box3 read of a Float32 attribute off a rounded-box fillet, held to
// 1e-3 cm - a millimetre, two orders below every wall this file derives.
const DOHC_BASELINE = {
  solids: 52,
  distinctParts: 52,
  crankcaseVerts: 365, // the plain OD/ID lathe at 72 segments
  box: [-26.5, 26.5, -21.846, 21.846, -15.05, 21.846],
  panRails: [-22, 22, -3.1996, 3.1996, -11.6, -11.15],
  oilPan: [-21, 21, -2.9496, 2.9496, -14.6, -11.6],
};
const READ_EPS = 1e-3;
const ohvLayout = async () => await import('../src/engine/layout.js');
const CAST_MATS = ['castIronBlock', 'boreWall', 'bearingShell', 'fastenerDark', 'paintedGraphite', 'brass'];
const castMats = async (THREE) => {
  const mats = {};
  for (const name of CAST_MATS) mats[name] = new THREE.MeshStandardMaterial({ name });
  return mats;
};
const drawnBlock = async (variantId) => {
  const THREE = await import('three');
  const { createBlock } = await import('../src/render/block.js');
  return { THREE, block: createBlock(await castMats(THREE), variantId) };
};
const lobeXs = () => [...new Set(SPEC.cylinders.map((c) => B.stations[c.station]))];

test(`${OHV_CAST}: the switch publishes the walls a cam tunnel is bored to, and every tunnel radius, face and relief arc derives from them`, async () => {
  const L = await ohvLayout();
  const H = L.ohvHousing();
  const V = SPEC.variants.ohv;
  const C = V.belowCrankCm;
  const worst = L.worstOutlineR();
  const air = V.tunnel.lobeAirCm;
  const wall = SPEC.cam.bearing.housingWall;
  const railThk = B.panFlangeZ - B.panRailZ;
  // the bored tunnel and the cast wall under its machined floor
  assert.ok(near(H.tunnelBoreR, worst + air), `the tunnel bore ${H.tunnelBoreR} must be the swept nose ${worst} plus the published ${air} cm of lobe air`);
  assert.ok(near(H.tunnelWallR, H.tunnelBoreR + wall), `the cast boundary outside the bore reads ${H.tunnelWallR}: the bore plus the published ${wall} cm wall`);
  assert.ok(near(H.floorZ, -(C + H.tunnelBoreR)), `the machined tunnel floor ${H.floorZ} has to sit the bored radius under the ${C} cm cam axis`);
  assert.ok(near(H.skirtZ, H.floorZ - wall), `the skirt bottom ${H.skirtZ} has to stand one published cast wall below that floor`);
  // the bolt faces this variant has to cast for its own pan and the test stand
  assert.ok(near(H.panRailZ, H.skirtZ), 'the OHV pan-rail plane is the skirt bottom face itself');
  assert.ok(near(H.panFlangeZ, H.skirtZ + railThk), `the OHV pan flange plane ${H.panFlangeZ} has to be the published ${railThk} cm of rail above the rail plane`);
  assert.ok(H.panRailZ < B.panRailZ, `the OHV rail plane ${H.panRailZ} has to sit under the DOHC one ${B.panRailZ}: the skirt is what makes the difference`);
  assert.ok(near(H.skirtHalfY, housingOutRel), `the skirt half width ${H.skirtHalfY} must be the bearing stack's own housing wall outside the bolt/wrench line ${housingOutRel}`);
  assert.ok(near(H.skirtInboardY, housingInRel), `and its inside face the wrench-access line ${housingInRel}`);
  assert.ok(H.skirtHalfY > H.tunnelWallR, `the skirt walls (${H.skirtHalfY}) have to stand outside the bored tunnel (${H.tunnelWallR}) or they close the tunnel mouth`);
  // the relief the drum has to give up, and the chords that tie the skirt back on
  const offDown = (rr) => Math.acos(Math.min(1, Math.max(-1, (rr * rr + C * C - H.tunnelBoreR ** 2) / (2 * rr * C)))) * 180 / Math.PI;
  assert.ok(near(H.drumOpenDeg, 2 * offDown(OD), 1e-9), `the drum wall the bore cuts clean through is ${H.drumOpenDeg} deg wide, measured ${2 * offDown(OD)}`);
  assert.ok(near(H.drumNotchDeg, 2 * offDown(ID), 1e-9), `the arc across which the bore reaches the crankcase void is ${H.drumNotchDeg} deg, measured ${2 * offDown(ID)}`);
  assert.ok(H.drumNotchDeg > H.drumOpenDeg, 'the notch into the void wall is wider than the through-cut: the bored mouth is a wedge, not a slot');
  assert.ok(near(Math.hypot(H.skirtHalfY, H.skirtCornerZ), OD), `the skirt sides tie onto the OD circle at z ${H.skirtCornerZ}`);
  assert.ok(near(Math.hypot(H.skirtHalfY, H.skirtVoidZ), ID), `and onto the crankcase void wall at z ${H.skirtVoidZ}`);
  // every published arc endpoint has to lie on the circle it claims to be machined along
  const at = (phi) => [H.tunnelBoreR * Math.cos(phi), -C + H.tunnelBoreR * Math.sin(phi)];
  const onOD = (phi) => Math.abs(Math.hypot(...at(phi)) - OD) < 1e-6;
  const onVoid = (phi) => Math.abs(Math.hypot(...at(phi)) - ID) < 1e-6;
  for (const [name, [a0, a1]] of Object.entries({ boreLeft: H.arcs.boreLeft, boreRight: H.arcs.boreRight })) {
    assert.ok((onOD(a0) && onVoid(a1)) || (onVoid(a0) && onOD(a1)),
      `${name} has to run from the OD circle to the crankcase void circle (or back): reads OD ${onOD(a0)}/${onOD(a1)} void ${onVoid(a0)}/${onVoid(a1)}`);
  }
  assert.ok(H.arcs.boreLeft[0] > H.arcs.boreLeft[1], 'the bored face on the -y side is run inward, from the OD crossing down to the void crossing');
  assert.ok(H.arcs.boreRight[0] < H.arcs.boreRight[1], 'and the +y side the other way round, from the OD crossing up to the void crossing');
  assert.ok(H.arcs.boreFloor[0] < H.arcs.boreFloor[1], 'the tunnel floor arc is run the long way past the lowest point of the swept outline');
  // the binding constraint issue #16 measured: this casting may not put a wall between
  // the crank-side swings and the cam, because the room there IS the air the swings are owed
  const maxSweep = Math.max(...L.crankSwings().map((s) => s[1]));
  assert.ok(near(H.crankRoomR, C - maxSweep), `the crank-side room ${H.crankRoomR} cm is the ${C} cm axis minus the ${maxSweep} cm swing`);
  assert.ok(H.castOdR <= H.crankRoomR - V.tunnel.crankSideAirCm,
    `a cam bearing cast to ${H.castOdR} cm stood toward the crank leaves ${(H.crankRoomR - H.castOdR).toFixed(4)} cm of the ${V.tunnel.crankSideAirCm} cm the swings are owed`);
  assert.equal(H.riserRefused, true,
    `the DOHC head bolts its cam cover onto a housing riser at ${housingOutRel} cm; stood here it leaves only ${(H.crankRoomR - housingOutRel).toFixed(4)} cm, so the OHV variant has to refuse it by name`);
  console.log(`${OHV_CAST} derivation: cam axis ${C} cm, bore ${H.tunnelBoreR.toFixed(4)} / cast OD ${H.tunnelWallR.toFixed(4)} / floor z ${H.floorZ.toFixed(4)} / skirt bottom z ${H.skirtZ.toFixed(4)}; rails ${H.panRailZ.toFixed(4)}..${H.panFlangeZ.toFixed(4)}; skirt y +/-${H.skirtHalfY.toFixed(4)} (inside ${H.skirtInboardY.toFixed(4)}); drum opening ${H.drumOpenDeg.toFixed(4)} deg, notch ${H.drumNotchDeg.toFixed(4)} deg, corners z ${H.skirtCornerZ.toFixed(4)}/${H.skirtVoidZ.toFixed(4)}; crank-side room ${H.crankRoomR.toFixed(4)} cm against a ${H.castOdR} cm bearing cast and a refused ${housingOutRel.toFixed(4)} cm riser`);
});

test(`${OHV_CAST}: the drawn OHV casting bores that tunnel out of its own drum wall - no cast iron stands inside the swept outline, and the machined floor is a real face at the published height`, async () => {
  const { THREE, block } = await drawnBlock('ohv');
  const L = await ohvLayout();
  const H = L.ohvHousing();
  const { newShell, shellAdd, nearestInShell } = await import('./support/surface-clearance.mjs');
  const solids = block.children.filter((m) => m.userData.solid);
  assert.ok(solids.length >= 45, `the OHV casting draws ${solids.length} solids; the block census this tree records is 45+`);
  const drum = solids.find((m) => m.userData.part === 'crankcase');
  assert.ok(drum, `no relieved crankcase in the OHV census: ${solids.map((m) => m.userData.part).join(', ')}`);
  // arc chord sampling: how far a bored face sampled at the published step may
  // fall inside the ideal circle. Nothing may be forgiven beyond this.
  const sag = (r) => r * (1 - Math.cos(H.arcStepRad / 2));
  const tol = sag(H.tunnelBoreR);
  // 1. nothing this casting draws stands inside the bored tunnel at a lobe position
  const X = [B.stations[3] - B.pitch / 2, B.stations[0] + B.pitch / 2];
  let inside = 0, closest = Infinity, closestWho = null, closestAt = null;
  for (const m of solids) {
    const pos = m.geometry.attributes.position;
    m.updateWorldMatrix(true, false);
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (v.x < X[0] - 1e-9 || v.x > X[1] + 1e-9) continue; // only where a lobe can be
      const d = Math.hypot(v.y, v.z + H.belowCrankCm) - H.tunnelBoreR;
      if (d < closest) { closest = d; closestWho = m.userData.part; closestAt = [v.x, v.y, v.z]; }
      if (d < -tol) inside++;
    }
  }
  assert.equal(inside, 0, `${inside} vertices of the drawn OHV casting stand inside the bored tunnel radius ${H.tunnelBoreR}; closest ${closest.toFixed(4)} cm inside it at ${JSON.stringify(closestAt)} (owner ${closestWho}) - this is the penetration issue #16 measured against this drum`);
  // 2. the swept outline therefore keeps its published air off a real face
  const shell = newShell();
  for (const m of solids) shellAdd(shell, m);
  const worst = H.worstOutlineR;
  let worstAir = Infinity, worstAt = null, worstInto = null;
  for (const x of lobeXs()) {
    for (let deg = 0; deg < 360; deg += 5) {
      const th = deg * Math.PI / 180;
      const p = new THREE.Vector3(x, worst * Math.cos(th), -H.belowCrankCm + worst * Math.sin(th));
      const r = nearestInShell(shell, p);
      if (r.d < worstAir) { worstAir = r.d; worstAt = [x, deg]; worstInto = r.who; }
    }
  }
  assert.ok(worstAir >= H.lobeAirCm - tol, `the swept cam outline comes within ${worstAir.toFixed(4)} cm of cast iron at lobe x ${worstAt[0]} angle ${worstAt[1]} deg (owner ${worstInto}); the published lobe air is ${H.lobeAirCm} cm and a face sampled at ${H.arcStepRad.toFixed(6)} rad can fall ${tol.toFixed(5)} cm short`);
  // 3. the machined floor exists as a face at the published tunnel radius
  let faces = 0, faceMin = Infinity;
  for (const m of solids) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      const d = Math.hypot(v.y, v.z + H.belowCrankCm);
      if (Math.abs(d - H.tunnelBoreR) < 1e-6) { faces++; faceMin = Math.min(faceMin, d); }
    }
  }
  assert.ok(faces >= 64, `only ${faces} drawn vertices sit on the machined tunnel face at radius ${H.tunnelBoreR}: the casting has no bored tunnel to inspect`);
  console.log(`${OHV_CAST} drawn: closest cast iron to the cam axis ${(-closest).toFixed(4)} cm vs the bored radius ${H.tunnelBoreR.toFixed(4)} (${closestWho} at ${JSON.stringify(closestAt)}); swept-outline air ${worstAir.toFixed(4)} cm against ${H.lobeAirCm} at ${JSON.stringify(worstAt)} owner ${worstInto}; ${faces} vertices on the machined face (min radius ${faceMin.toFixed(6)}), arc-chord allowance ${tol.toFixed(5)} cm`);
});

test(`${OHV_CAST}: the skirt carries the tunnel floor and this variant bolts its pan on its own faces, while the tunnel stays open into the crankcase the lobes swing in`, async () => {
  const { THREE, block } = await drawnBlock('ohv');
  const L = await ohvLayout();
  const H = L.ohvHousing();
  const P = L.panPlanes('ohv');
  const solids = block.children.filter((m) => m.userData.solid);
  const drum = solids.find((m) => m.userData.part === 'crankcase');
  const rails = solids.filter((m) => m.userData.part === 'pan-rails');
  const pan = solids.find((m) => m.userData.part === 'oil-pan');
  const plug = solids.find((m) => m.userData.part === 'pan-plug');
  assert.ok(drum && rails.length === 1 && pan && plug, `skirt/pan hardware missing from the OHV census: ${solids.map((m) => m.userData.part).join(', ')}`);
  // the skirt: its bottom face is the variant's rail plane, its width the derived one
  const dbb = new THREE.Box3().setFromObject(drum);
  assert.ok(Math.abs(dbb.min.z - H.skirtZ) < 1e-6, `the casting bottoms out at z ${dbb.min.z.toFixed(6)}, the published skirt face is ${H.skirtZ}`);
  let bottomY = 0;
  const dpos = drum.geometry.attributes.position;
  for (let i = 0; i < dpos.count; i++) {
    if (Math.abs(dpos.getZ(i) - H.skirtZ) > 1e-6) continue;
    bottomY = Math.max(bottomY, Math.abs(dpos.getY(i)));
  }
  assert.ok(Math.abs(bottomY - H.skirtHalfY) < 1e-6, `the skirt bottom face spans y +/-${bottomY.toFixed(4)}, derived from the bolt/wrench line at ${H.skirtHalfY}`);
  assert.ok(Math.abs(dbb.max.y - OD) < 1e-6 && Math.abs(dbb.min.y + OD) < 1e-6, `the relieved casting has to keep the drum it is cast around: reads y ${dbb.min.y.toFixed(4)}..${dbb.max.y.toFixed(4)} against OD ${OD}`);
  assert.ok(dbb.min.x <= B.stations[3] - B.pitch / 2 + 1e-9 && dbb.max.x >= B.stations[0] + B.pitch / 2 - 1e-9,
    `the tunnel has to run the full length of the station slabs: reads x ${dbb.min.x}..${dbb.max.x}`);
  // its own bolt planes, and the sump hanging off them
  const rbb = new THREE.Box3().setFromObject(rails[0]);
  assert.ok(Math.abs(rbb.min.z - P.railZ) < 1e-6 && Math.abs(rbb.max.z - P.flangeZ) < 1e-6,
    `the OHV pan rails read z ${rbb.min.z.toFixed(4)}..${rbb.max.z.toFixed(4)} against the variant's bolt planes ${P.railZ}..${P.flangeZ}`);
  assert.ok(Math.abs(rbb.max.y - P.flangeHalfY) < 1e-6, `and |y| ${rbb.max.y.toFixed(4)} against the derived flange half width ${P.flangeHalfY}`);
  const pbb = new THREE.Box3().setFromObject(pan);
  assert.ok(Math.abs(pbb.max.z - P.railZ) < 1e-6 && Math.abs(pbb.min.z - P.panBottomZ) < 1e-6,
    `the OHV oil pan reads z ${pbb.min.z.toFixed(4)}..${pbb.max.z.toFixed(4)}: it has to hang ${B.oilPanDepthCm} cm below its own rail plane ${P.railZ}`);
  const lbb = new THREE.Box3().setFromObject(plug);
  assert.ok(Math.abs(lbb.min.z - (P.panBottomZ - B.oilPanPlugDropCm)) < 1e-6,
    `the drain plug reaches z ${lbb.min.z.toFixed(4)}, the published ${B.oilPanPlugDropCm} cm below the pan bottom ${P.panBottomZ}`);
  // and the tunnel is not a blind pocket: straight up from the machined floor the
  // lobes have the crankcase, and the first cast face above the floor is the void wall
  const ray = new THREE.Raycaster();
  const up = new THREE.Vector3(0, 0, 1);
  const readings = [];
  for (const x of lobeXs()) {
    ray.set(new THREE.Vector3(x, 0, H.floorZ + 0.001), up);
    const hits = ray.intersectObjects(solids, false).filter((h) => h.distance > 1e-6);
    const first = hits[0];
    assert.ok(first, `no cast face at all above the tunnel floor at lobe x ${x}: the tunnel was not drawn`);
    const z = first.point.z;
    assert.ok(Math.abs(z - ID) < 0.5, `at lobe x ${x} the first cast face above the machined floor reads z ${z.toFixed(4)}; the tunnel has to open straight into the crankcase void wall at z ${ID} (a ${ID - H.floorZ} cm column) so the lobes can swing`);
    readings.push(`x ${x}: floor ${H.floorZ.toFixed(2)} -> first face z ${z.toFixed(4)}`);
  }
  console.log(`${OHV_CAST} skirt/sump: casting z ${dbb.min.z.toFixed(4)}..${dbb.max.z.toFixed(4)} y ${dbb.min.y.toFixed(4)}..${dbb.max.y.toFixed(4)} x ${dbb.min.x.toFixed(2)}..${dbb.max.x.toFixed(2)}; rails z ${rbb.min.z.toFixed(4)}..${rbb.max.z.toFixed(4)} y +/-${rbb.max.y.toFixed(4)}; pan z ${pbb.min.z.toFixed(4)}..${pbb.max.z.toFixed(4)}; plug to z ${lbb.min.z.toFixed(4)}; tunnel openings ${readings.join('; ')}`);
});

test(`${OHV_CAST}: the switch casts two different blocks, and the DOHC casting this tree already ships - its census, its drum and its measured envelope - stays exactly as the closed rows record it`, async () => {
  const L = await ohvLayout();
  const THREE = await import('three');
  const { createBlock } = await import('../src/render/block.js');
  const mats = await castMats(THREE);
  const dohc = createBlock(mats);
  const ohv = createBlock(mats, 'ohv');
  const census = (g) => {
    const c = {};
    for (const m of g.children) { const k = m.userData.part; if (k) c[k] = (c[k] ?? 0) + 1; }
    return c;
  };
  const cd = census(dohc), co = census(ohv);
  assert.deepEqual(Object.keys(cd).sort(), Object.keys(co).sort(),
    `the two builds must cast the same named solids; DOHC ${Object.keys(cd).sort().join(', ')} vs OHV ${Object.keys(co).sort().join(', ')}`);
  // the DOHC casting measured against the pre-OHV record above, not against itself
  const readBox = (o) => {
    const b = new THREE.Box3().setFromObject(o);
    return [b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z];
  };
  const same = (label, got, want) => {
    const bad = got.map((v, i) => (Math.abs(v - want[i]) > READ_EPS ? `${v.toFixed(6)} != ${want[i]}` : null)).filter(Boolean);
    assert.equal(bad.length, 0, `${label} moved off the pre-OHV record: ${bad.join(', ')} (reading eps ${READ_EPS} cm)`);
  };
  const solidsD = dohc.children.filter((m) => m.userData.solid);
  const drumD0 = dohc.children.find((m) => m.userData.part === 'crankcase');
  assert.equal(solidsD.length, DOHC_BASELINE.solids, `the DOHC build now draws ${solidsD.length} solids, the pre-OHV record is ${DOHC_BASELINE.solids}`);
  assert.equal(Object.keys(cd).length, DOHC_BASELINE.distinctParts, `the DOHC part census now names ${Object.keys(cd).length} solids, the pre-OHV record is ${DOHC_BASELINE.distinctParts}`);
  assert.equal(drumD0.geometry.attributes.position.count, DOHC_BASELINE.crankcaseVerts,
    `the DOHC drum now draws ${drumD0.geometry.attributes.position.count} vertices, the pre-OHV lathe drew ${DOHC_BASELINE.crankcaseVerts}`);
  same('DOHC casting envelope', readBox(dohc), DOHC_BASELINE.box);
  same('DOHC pan rails', readBox(dohc.children.find((m) => m.userData.part === 'pan-rails')), DOHC_BASELINE.panRails);
  same('DOHC oil pan', readBox(dohc.children.find((m) => m.userData.part === 'oil-pan')), DOHC_BASELINE.oilPan);
  // no typed envelope here: the DOHC casting is held by the two readings this file
  // already runs green on (its own design-envelope law above, and the closed rows),
  // and by the fact that the shipped default call still reads the switch
  const bd = new THREE.Box3().setFromObject(dohc);
  const bsw = new THREE.Box3().setFromObject(createBlock(mats, SPEC.build.variant));
  assert.ok(near(bd.min.z, bsw.min.z) && near(bd.max.z, bsw.max.z) && near(bd.min.y, bsw.min.y) &&
    near(bd.max.y, bsw.max.y) && near(bd.min.x, bsw.min.x) && near(bd.max.x, bsw.max.x),
    `createBlock(mats) no longer builds the switch's own variant: default z ${bd.min.z.toFixed(4)}..${bd.max.z.toFixed(4)} vs createBlock(mats, '${SPEC.build.variant}') z ${bsw.min.z.toFixed(4)}..${bsw.max.z.toFixed(4)}`);
  assert.notEqual(SPEC.build.variant, 'ohv', 'the shipped default must stay the DOHC build this tree releases');
  const drumD = dohc.children.find((m) => m.userData.part === 'crankcase');
  const drumO = ohv.children.find((m) => m.userData.part === 'crankcase');
  const annulus = (m) => {
    const pos = m.geometry.attributes.position;
    let off = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getY(i), pos.getZ(i));
      if (Math.abs(r - OD) > 1e-6 && Math.abs(r - ID) > 1e-6) off++;
    }
    return off;
  };
  assert.equal(annulus(drumD), 0, `the DOHC drum is no longer a plain OD/ID annulus: ${annulus(drumD)} vertices sit off both circles`);
  assert.ok(annulus(drumO) > 0, 'the OHV crankcase is not relieved: it draws the same uncut drum that swallows the cam');
  const bo = new THREE.Box3().setFromObject(ohv);
  const P = L.panPlanes('ohv');
  assert.ok(Math.abs(bo.min.z - (P.panBottomZ - B.oilPanPlugDropCm)) < 1e-6,
    `the OHV casting reaches z ${bo.min.z.toFixed(4)}: the sump on its own rail plane ${P.railZ} hangs ${B.oilPanDepthCm} cm down plus the ${B.oilPanPlugDropCm} cm plug`);
  assert.ok(bo.min.z < bd.min.z - 2, `the OHV casting has to bottom out deeper than the DOHC one (${bd.min.z.toFixed(2)}) because its tunnel floor is at ${L.ohvHousing().floorZ.toFixed(2)}: reads ${bo.min.z.toFixed(2)}`);
  assert.ok(Math.abs(bo.max.z - bd.max.z) < 1e-9 && Math.abs(bo.max.y - bd.max.y) < 1e-9 && Math.abs(bo.max.x - bd.max.x) < 1e-9,
    `the decks, the drum width and the slab length are common to both builds: ohv z ${bo.max.z} y ${bo.max.y} x ${bo.max.x} vs dohc z ${bd.max.z} y ${bd.max.y} x ${bd.max.x}`);
  const P0 = L.panPlanes('dohc');
  assert.ok(near(P0.railZ, B.panRailZ) && near(P0.flangeZ, B.panFlangeZ) && near(P0.panBottomZ, bd.min.z + B.oilPanPlugDropCm, GEOM_EPS),
    `the DOHC pan planes derive wrong: ${P0.railZ}..${P0.flangeZ} bottom ${P0.panBottomZ} vs the drawn casting bottom ${bd.min.z.toFixed(4)} (Float32 attribute resolution ${GEOM_EPS})`);
  assert.ok(near(P.flangeHalfY, L.ohvHousing().skirtHalfY) && near(P.wallHalfY, L.ohvHousing().skirtInboardY),
    `the OHV bolt widths derive wrong: flange ${P.flangeHalfY} wall ${P.wallHalfY}`);
  console.log(`${OHV_CAST} two castings: dohc ${JSON.stringify(cd)} z ${bd.min.z.toFixed(2)}..${bd.max.z.toFixed(2)} drum unrelieved; ohv ${JSON.stringify(co)} z ${bo.min.z.toFixed(2)}..${bo.max.z.toFixed(2)} relieved at ${annulus(drumO)} relief vertices; dohc planes ${P0.railZ}..${P0.flangeZ} bottom ${P0.panBottomZ}, ohv planes ${P.railZ}..${P.flangeZ} bottom ${P.panBottomZ}`);
});
