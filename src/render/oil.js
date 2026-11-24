// Slice 8D-2a (issue #8 addendum item 5, GATES row A1-G4): the DRAWN oil assembly.
//
// Every mesh here is a drilling that src/engine/oil.js already publishes: the mesh
// name is that network's bore id, its radius is the `drillR` the route publishes,
// its legs are the `path` the route publishes, and `userData.from` is the `from`
// chain `provenance()` walks. The tree and the laws in test/oil.test.mjs therefore
// read one set of numbers - nothing here is a second copy of a published value, and
// no count in this file is typed.
//
// Each bore is ONE merged mesh made of straight open tubes, one per published leg:
// a real oil way is drilled in stages, so a junction is a corner, not a fillet. The
// tubes are open-ended because a drilling has no caps - which is also what the mouth
// clauses in test/oil.test.mjs measure: the nearest vertex to the point a way opens
// at stands at exactly that way's drill radius off it.
//
// What this file does NOT draw, and says so:
//   - the drilled oil holes INSIDE the iron (main-shell-*, the 56 cam shells and their
//     cradles, the OHV tunnel bushings, the rod body). That is slice 8D-2b and
//     SPEC.oil.pending.drawnHoles names each one, with its issue.
//   - the OHV inboard gallery and the OHV fore/aft main feeds (issue #28) and any
//     lifter gallery feed (issue #16). The network publishes them as pending, so
//     nothing is drawn for them; test/oil.test.mjs gates their absence.
//   - any pressure, flow or pump-drive kinematics. Nothing in SPEC models how the
//     pump is turned or what it delivers, so nothing here animates: createOil returns
//     a static assembly and has no update(). The oil system's live behaviour is the
//     HUD and the galleries a section plane cuts, not a moving part.
//
// Pinned by the six "oil 8D-2a" laws in test/oil.test.mjs.
import * as THREE from 'three';
import { SPEC, endDiscFaceX } from '../engine/spec.js';
import { oilNetwork } from '../engine/oil.js';
import { cylinderBetween, mergeGeometries } from './primitives.js';

const OIL = SPEC.oil;

/**
 * Facets around a drilling. The thinnest published way is SPEC.oil.feedDrillR
 * (SPEC.cam.bearing.oilHoleR) and the widest is SPEC.oil.galleryR, so two settings
 * cover the whole census: 12 facets on a feed, 16 on a gallery.
 */
const facets = (r) => (r >= OIL.galleryR / 2 ? 16 : 12);

/** How many stations a published span is split into so its wall carries vertices. */
const CHAMBERS = 4;

function mesh(name, geometry, material, userData = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData = { kind: 'oil', ...userData };
  return m;
}

/** Every bore the published network lists, in route order: supply, galleries, links,
 * bridges, then the feeds. Pending members are NOT in this list. */
function bores(net) {
  return [net.supply, ...net.galleries, ...net.camGalleries, ...net.links, ...net.bridges, ...net.feeds];
}

/**
 * One published drilling: a straight open tube along every published leg, merged into
 * a single mesh. Open because a drill leaves a way, not a capped pipe; merged because
 * a bore is one hole, and the inspection menu and the section cut should treat it as
 * one member of the casting it is bored in.
 */
function drilling(path, r, radial = facets(r)) {
  const legs = [];
  for (let i = 0; i + 1 < path.length; i++) legs.push(cylinderBetween(path[i], path[i + 1], r, radial, true));
  return mergeGeometries(legs, false);
}

/** `n` stations evenly spaced along a published span, endpoints included. */
function stations(a, b, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

/** The point a published way runs on, extended past `b` by `extra` along its own
 * direction (used for the standing iron that holds the pump). */
function extend(a, b, extra) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...d);
  const u = d.map((c) => c / len);
  return [b[0] + u[0] * extra, b[1] + u[1] * extra, b[2] + u[2] * extra];
}

function drawBore(bore, materials) {
  return mesh(bore.id, drilling(bore.path, bore.drillR), materials.oilFilm, {
    kind: 'bore',
    id: bore.id,
    part: bore.part,
    drillR: bore.drillR,
    from: bore.from ?? bore.gallery ?? null,
  });
}

/**
 * The pump: its published suction mouth (SPEC.oil.pump stand + r, `pump.inlet`), its
 * published discharge mouth (`pump.outlet`) and the way between them at
 * SPEC.oil.pump.r. The span is 2 x pump.r, so it is drawn through CHAMBERS stations:
 * an open tube long enough to have a measurable wall along it, which is what law 14
 * reads. The housing is the iron the pump stands in - the published pump radius plus
 * the published pump way (SPEC.oil.pumpDrillR) on every side and at each end - centred
 * exactly on the published stand, because that is the one position the network fixes.
 */
function drawPump(net, materials) {
  const P = net.pump;
  const group = new THREE.Group();
  group.name = P.id;
  const way = mesh('oil-pump-body', drilling(stations(P.inlet, P.outlet, CHAMBERS), P.r, 16), materials.oilFilm, {
    kind: 'pump-way',
    id: P.id,
    part: P.part,
    drillR: P.r,
  });
  const r = P.r + P.drillR;
  const a = extend(P.outlet, P.inlet, P.drillR);
  const b = extend(P.inlet, P.outlet, P.drillR);
  const housing = mesh('oil-pump-housing', cylinderBetween(a, b, r, 20, false), materials.aluTube, {
    kind: 'pump-iron',
    id: P.id,
    derived: 'SPEC.oil.pump.r + SPEC.oil.pumpDrillR',
  });
  group.add(way, housing);
  return group;
}

/**
 * The pan pickup: its screen hanging above the sump floor at the published
 * SPEC.pickupX / panPlanes(id).panBottomZ + SPEC.oil.pickupDropCm, and its stem -
 * which IS the published pump inlet - bored at SPEC.oil.pumpDrillR up through the pan
 * wall to that inlet. The screen is drawn as wide as the stem it strains, because a
 * screen narrower than the way it feeds would be an obstruction, not a filter.
 */
function drawPickup(net, materials) {
  const K = net.pickup;
  const group = new THREE.Group();
  group.name = K.id;
  const stem = mesh('oil-pan-pickup-stem', drilling([K.screen, K.stem], OIL.pumpDrillR), materials.aluTube, {
    kind: 'pickup-way',
    id: K.id,
    part: K.part,
    drillR: OIL.pumpDrillR,
  });
  const w = OIL.pumpDrillR * 2; // the screen spans four drill radii along the pan
  const r = OIL.pumpDrillR * 1.5; // and stands wider than the stem it strains
  const screen = mesh('oil-pan-pickup-screen',
    cylinderBetween([K.screen[0] - w, K.screen[1], K.screen[2]], [K.screen[0] + w, K.screen[1], K.screen[2]], r, 16, false),
    materials.brass, { kind: 'pickup-screen', id: K.id, part: K.part });
  group.add(stem, screen);
  return group;
}

/**
 * The gauge: a tap bored at SPEC.oil.pumpDrillR from the published point the network
 * says it reads (`gauge.at`, on the axis of the gallery it reads) out through the
 * block's own end disc to its machined face (endDiscFaceX()), and the dial standing
 * on that stub. The case stays inboard of the flywheel face the oracle classifies at
 * |x| 27.75, so the gauge never stands inside the rotating assembly.
 */
function drawGauge(net, materials) {
  const G = net.gauge;
  const group = new THREE.Group();
  group.name = G.id;
  const face = endDiscFaceX();
  const sgn = Math.sign(G.at[0]); // the gallery is read at its aft end in both variants
  const stub = [sgn * (face + OIL.pumpDrillR), G.at[1], G.at[2]];
  const tap = mesh('oil-pressure-gauge-tap', drilling([G.at, [sgn * face, G.at[1], G.at[2]], stub], OIL.pumpDrillR),
    materials.brass, { kind: 'gauge-tap', id: G.id, reads: G.reads, drillR: OIL.pumpDrillR });
  const caseR = OIL.pumpDrillR * 2.5;
  const a = [sgn * (face + OIL.pumpDrillR * 1.5), G.at[1], G.at[2]];
  const b = [sgn * (face + OIL.pumpDrillR * 4.5), G.at[1], G.at[2]];
  const kase = mesh('oil-pressure-gauge-case', cylinderBetween(a, b, caseR, 24, false), materials.gaugeCase,
    { kind: 'gauge-iron', id: G.id, reads: G.reads });
  const dial = [sgn * (face + OIL.pumpDrillR * 4.7), G.at[1], G.at[2]];
  const faceMesh = mesh('oil-pressure-gauge-face',
    cylinderBetween(dial, [sgn * (face + OIL.pumpDrillR * 4.9), G.at[1], G.at[2]], caseR * 0.82, 24, false),
    materials.gaugeFace, { kind: 'gauge-dial', id: G.id, reads: G.reads });
  group.add(tap, kase, faceMesh);
  return group;
}

/**
 * The whole oil assembly of one variant: every published bore as its own mesh, plus
 * the pump, its pickup and the gauge. Geometry is baked in world coordinates, so a
 * member's matrix is the identity and a law measuring its vertices measures the
 * published station directly.
 * @returns {{group:THREE.Group}}
 */
export function createOil(materials, variantId = SPEC.build.variant) {
  const net = oilNetwork(variantId);
  const group = new THREE.Group();
  group.name = 'oil';
  for (const bore of bores(net)) group.add(drawBore(bore, materials));
  group.add(drawPump(net, materials), drawPickup(net, materials), drawGauge(net, materials));
  return { group };
}
