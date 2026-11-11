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
