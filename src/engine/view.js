// View-control math: CUTAWAY, EXPLODED VIEW / ASSEMBLE, PART INSPECTION.
//
// This module is the law; src/ui/viewControls.js is the plumbing that measures
// the real scene graph and applies it. Nothing here knows about the DOM.
//
// Two principles the tests measure:
//
// 1. DERIVED, NOT INVENTED. Every cutaway plane comes from the published camera
//    home pose and the crank centreline; every explode direction comes from a
//    real assembly axis (a bank normal, the crank axis, the valve/bolt axis or
//    world vertical); every explode DISTANCE comes from the members' measured
//    extents along that axis plus two published scalars (gap, clearance). There
//    is no per-part magic number anywhere in this file.
//
// 2. THE CHAIN LAW. Along one build axis, parts separate in BUILD ORDER: the
//    part installed first moves least, the part installed last moves most, and a
//    part may never land closer to its neighbour than `clearance`, because two
//    parts whose footprints overlap along the axis cannot both be seen. So for a
//    family sorted by stage:
//
//        off(stage_k) = max( stage_k * gap,
//                             farExploded(stage_{k-1}) + clearance - near_k )
//
//    which is exactly what a service manual draws, and what makes an exploded
//    view legible rather than a pile.
import { SPEC, bankOut, bankUp } from './spec.js';

const V = SPEC.view;

// ---------------------------------------------------------------- vectors ----
// Plain arrays: cm, world frame (X = crank axis, Z up). Same convention as
// src/engine/spec.js: L = -y, R = +y, fore = +x, aft = -x.
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const unit = norm;
export const proj = dot;

// ---------------------------------------------------------------- cutaway ----
/**
 * The cutaway plane.
 *
 * A plane through the crank centreline has no X term in its normal (the crank
 * axis IS the X axis, so the normal must be perpendicular to it): the whole
 * plane is described by its polar azimuth in the YZ plane, exactly the same
 * convention src/engine/spec.js uses for bore axes.
 *
 * The azimuth is not chosen by taste: it is the home view's own direction. The
 * eye-to-focus vector is projected into the YZ plane and flipped, so the half
 * space the camera is standing in is the one that gets cut away, and the section
 * face turns towards the camera that asked for it.
 *
 * three clips the half space where normal.p + constant < 0 (the kept side is
 * where it is positive), so the normal points AWAY from the camera.
 */
export function cutawaySpecs(opts = {}) {
  const pos = opts.eye ?? V.homePos;
  const target = opts.target ?? V.homeTarget;
  const eyeToFocus = [pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]];
  const lateral = norm([0, eyeToFocus[1], eyeToFocus[2]]);
  const normal = [-lateral[0], -lateral[1], -lateral[2]]; // points into the kept half
  const lift = opts.lift ?? 0;
  // the plane passes through the crank axis; when the assembly is hoisted by the
  // explode lift, the cut follows the assembly instead of cutting through mid-part
  const constant = -dot(normal, [0, 0, lift]);
  return {
    normal,
    constant,
    lift,
    azimuthDeg: (Math.atan2(normal[1], normal[2]) * 180) / Math.PI,
    // which side survives: the far side from the home eye
    keeps: (p) => dot(normal, p) + constant >= 0,
    source: 'SPEC.view.homePos/homeTarget projected into the YZ plane (the plane contains the crank axis)',
  };
}

// ------------------------------------------------------------- explode table --
/**
 * Bank of a part, read from its name: either an explicit -L-/-R- in the casting
 * name, or the cylinder number for the per-cylinder parts (cylinders 1,3,5,7 are
 * bank L: SPEC.banks.L.cyls).
 */
export function partBank(name) {
  const explicit = /(?:^|-)([LR])(?:$|-)/.exec(name);
  if (explicit) return explicit[1];
  const cyl = /cyl(\d+)/.exec(name);
  if (!cyl) return null;
  const c = SPEC.cylinders.find((k) => k.num === Number(cyl[1]));
  return c ? c.bank : null;
}

const DIRS = {
  'bank-L': () => bankUp('L'),
  'bank-R': () => bankUp('R'),
  'bore-L': () => bankUp('L'),
  'bore-R': () => bankUp('R'),
  'out-L': () => bankOut('L'),
  'out-R': () => bankOut('R'),
  fore: () => [1, 0, 0],
  aft: () => [-1, 0, 0],
  down: () => [0, 0, -1],
  top: () => [0, 0, 1],
  // a DOHC camshaft leaves the head along its own bearing axis, which is parallel
  // to the crank axis: it is pulled out of the cam towers fore, not lifted with
  // the head stack. That is a different axis, so it is a different family.
  cams: () => [1, 0, 0],
};

const rule = (re, family, stage) => ({ re, family, stage });

/**
 * The published teardown/build hierarchy. `stage` is the part's position in the
 * build order of its own interface stack - it comes from how the engine is put
 * together (see the comments), not from a distance. Parts sharing a family AND a
 * stage are siblings: they travel together as one level.
 *
 * build order per stack (what gets installed first -> last). A stack is one
 * family = one axis, and its stages are the order the parts are actually put in,
 * bottom-up, so a stage that is installed further outboard also ends up further
 * outboard when the stack is pulled apart:
 *
 *   bank-L / bank-R (up the bore axis of that bank):
 *          connecting rod -> piston -> head gasket -> head casting -> valves ->
 *          valve springs -> spring buckets (tappets) -> cam covers.
 *          ONE chain per bank, not two: the bores and the head sit on the same
 *          axis, so a piston pulled up its bore must clear the head that covers
 *          that bore. Splitting them into two chains lets a piston overtake the
 *          head it came out of, which is exactly what the first measurement of
 *          this table showed (pistons at 34.6 cm, heads at 12.0 cm).
 *   down : crank -> main bearing shells -> main caps -> cap bolts -> oil pan
 *          (+ its drain plug, which travels with the pan)
 *   fore : fore end disc -> fore main bushing -> cam drive sprocket (all slid off the nose)
 *   aft  : aft end disc -> aft main bushing -> flywheel (unbolted from the flange)
 *   out  : exhaust headers -> flange bolts (the bolts are the last thing at the flange)
 *   top  : head bolts -> intake plenums (the plenums sit over the valley, above everything)
 *   cams : each camshaft is pulled along its own bearing axis (fore), which is
 *          why it is not in the bank chain: it leaves the head sideways, not up.
 *
 * Parts deliberately NOT in the table, i.e. they stay with the reference casting
 * because they have no service interface in this model: crankcase, end-of-block
 * webs and support columns, cylinder liners (press-fit in the bore tunnel), the
 * main bearing necks/shells of the case itself (main-neck-*), and the pan rails,
 * which are cast integral with the block.
 */
export function explodeRules() {
  return [
    rule(/^crank$/, 'down', 1),
    rule(/^main-shell-x-?[\d.]+$/, 'down', 2),
    rule(/^main-cap-/, 'down', 3),
    rule(/^main-bolt-/, 'down', 4),
    rule(/^oil-pan$/, 'down', 5),
    rule(/^pan-plug$/, 'down', 5),

    rule(/^rod-cyl\d+$/, (n) => `bank-${partBank(n)}`, 1),
    rule(/^piston-cyl\d+$/, (n) => `bank-${partBank(n)}`, 2),
    rule(/^gasket-[LR]$/, (n) => `bank-${partBank(n)}`, 3),
    rule(/^head-[LR]$/, (n) => `bank-${partBank(n)}`, 4),
    rule(/^valve-cyl\d+-(intake|exhaust)$/, (n) => `bank-${partBank(n)}`, 5),
    rule(/^spring-cyl\d+-(intake|exhaust)$/, (n) => `bank-${partBank(n)}`, 6),
    rule(/^bucket-cyl\d+-(intake|exhaust)$/, (n) => `bank-${partBank(n)}`, 7),
    rule(/^cam-cover-[LR]-(intake|exhaust)$/, (n) => `bank-${partBank(n)}`, 8),

    rule(/^cam-[LR]-(intake|exhaust)$/, 'cams', 2),

    // The cam-drive sprocket is bolted to the crank nose and the flywheel to the
    // crank aft flange - in this model both are built INSIDE the crank group, so
    // they are not separate members and they travel with the crank. A rule naming
    // them would select nothing, which is exactly what the coverage test caught.
    rule(/^end-disc-fore$/, 'fore', 2),
    rule(/^main-bush-fore$/, 'fore', 3),

    rule(/^end-disc-aft$/, 'aft', 2),
    rule(/^main-bush-aft$/, 'aft', 3),

    rule(/^headers-[LR]$/, (n) => `out-${partBank(n)}`, 2),
    // the flange bolts travel WITH the headers: they are the joint that holds the
    // flange, exactly like the drain plug travels with the oil pan. Giving them a
    // later stage than the headers measured 43.5 cm of separation, which throws
    // the bolts off the flange they belong to for no informational gain.
    rule(/^flange-bolts-[LR]$/, (n) => `out-${partBank(n)}`, 2),

    rule(/^head-bolts$/, 'top', 2),
    rule(/^intake-[LR]$/, 'top', 3),
  ];
}

export function explodeSpecs() {
  return {
    gap: 6, // cm of deliberate separation per build stage: the visible gap
    clearance: 2.5, // cm a part must keep from the part it follows along its axis
    floorMargin: 3, // cm the hoisted assembly keeps above the cell floor plate
    explodeFamilies: Object.keys(DIRS),
  };
}

export const explodeDirection = (family) => norm(DIRS[family]());

/** Which family/stage a member belongs to; null = it stays with the casting. */
export function explodeRuleFor(name) {
  for (const r of explodeRules()) {
    if (r.re.test(name)) {
      const family = typeof r.family === 'function' ? r.family(name) : r.family;
      if (!(family in DIRS)) throw new Error(`explode rule for "${name}" selects unknown family "${family}"`);
      return { name, family, stage: r.stage, dir: explodeDirection(family) };
    }
  }
  return null;
}

/**
 * Apply the chain law to measured extents.
 *
 * @param {Map<string,{near:number,far:number}>} extents  per member, its extent
 *   along its own family direction (measured on the real triangles by
 *   src/ui/viewControls.js - not a world axis-aligned box, which would inflate a
 *   diagonal direction).
 * @returns {{offsets:Map<string,{family,stage,dir,dist}>, families:Map<string,Array>}}
 */
export function explodeOffsets(extents, opts = {}) {
  const S = { ...explodeSpecs(), ...opts };
  const members = [...extents.keys()].map((name) => ({ name, ...explodeRuleFor(name), ...extents.get(name) })).filter((m) => m.family);
  const families = new Map();
  for (const m of members) {
    if (!families.has(m.family)) families.set(m.family, []);
    families.get(m.family).push(m);
  }
  const offsets = new Map();
  for (const [family, list] of families) {
    const dir = explodeDirection(family);
    // one LEVEL per stage: siblings (same interface, same stage) travel together
    const stages = [...new Set(list.map((m) => m.stage))].sort((a, b) => a - b);
    let prevFar = -Infinity;
    let prevDist = 0;
    for (const stage of stages) {
      const level = list.filter((m) => m.stage === stage);
      let dist = stage * S.gap;
      for (const m of level) {
        const geo = prevFar + S.clearance - m.near;
        if (geo > dist) dist = geo;
      }
      // MONOTONE CARRY: a stack fans out, it never folds back. Two levels can
      // have different installed positions along the axis (a bearing shell sits
      // deeper than the cap above it), so the raw clearance requirement for a
      // later stage can come out SMALLER than an earlier stage already achieved -
      // measured 21.90 cm for the shells and 18.95 cm for the caps above them,
      // which would have parked the caps inside the shells they sit on. A stage
      // installed further out therefore never travels less than the one under it.
      if (dist < prevDist) dist = prevDist;
      if (dist < 0) dist = 0;
      let levelFar = -Infinity;
      for (const m of level) {
        offsets.set(m.name, { family, stage, dir, dist });
        levelFar = Math.max(levelFar, m.far + dist);
      }
      prevFar = levelFar;
      prevDist = dist;
    }
  }
  return { offsets, families, spec: S };
}

/**
 * How far the whole assembly has to be hoisted so no exploded member sinks
 * through the test-cell floor plate. Derived from the same measured extents that
 * produced the offsets: it is a consequence of the chain, never a tuned number.
 *
 * @param {Array<{name:string, minZ:number}>} lowest per member, its lowest world z
 *   once its offset has been applied (fraction 1).
 */
export function explodeLift(lowest, opts = {}) {
  const S = { ...explodeSpecs(), ...opts };
  const floor = SPEC.stand.floorZ + S.floorMargin;
  let min = Infinity;
  for (const l of lowest) min = Math.min(min, l.minZ);
  if (!Number.isFinite(min)) return 0;
  return Math.max(0, floor - min);
}

/**
 * The extra hoist a member needs so it does not come to rest INSIDE the stand's
 * mount hardware - the plates and locator jaws the assembled engine is actually
 * clamped by. The hoist is a pure +Z translation, so the only escape from a mount
 * envelope is above or below it; the law returns the smallest hoist that
 * separates, and null when the member can be lifted clear but the choice has to
 * be reported rather than guessed.
 *
 * @param {{min:number[],max:number[]}} box member box with its offset applied,
 *   measured at hoist 0
 * @param {number[]} shift     dir * dist already applied to the member
 * @param {{min:number[],max:number[]}} mount one mount-hardware box
 * @param {number} at          the hoist already required by the floor law
 */
export function mountClearLift(box, shift, mount, at = 0, clearance = SPEC.stand.minAir) {
  const x0 = box.min[0] + shift[0];
  const x1 = box.max[0] + shift[0];
  const y0 = box.min[1] + shift[1];
  const y1 = box.max[1] + shift[1];
  const z0 = box.min[2] + shift[2];
  const z1 = box.max[2] + shift[2];
  const disjoint = (a0, a1, b0, b1) => a1 <= b0 || b1 <= a0;
  if (disjoint(x0, x1, mount.min[0], mount.max[0])) return 0;
  if (disjoint(y0, y1, mount.min[1], mount.max[1])) return 0;
  const clearBelow = z1 + at <= mount.min[2] - clearance;
  const clearAbove = z0 + at >= mount.max[2] + clearance;
  if (clearBelow || clearAbove) return 0;
  const below = mount.min[2] - clearance - z1;
  const above = mount.max[2] + clearance - z0;
  const feasible = [below, above].filter((L) => Number.isFinite(L) && L > at);
  return feasible.length ? Math.min(...feasible) : null;
}

// --------------------------------------------------------------- inspection ---
/** Human-readable identity of a pickable part, read from its name. */
export function partLabel(name) {
  const perCyl = /^(piston|rod|valve|spring|bucket)-cyl(\d+)(?:-(intake|exhaust))?$/.exec(name);
  if (perCyl) {
    const c = SPEC.cylinders.find((k) => k.num === Number(perCyl[2]));
    const what = { piston: 'Piston', rod: 'Connecting rod', valve: 'Valve', spring: 'Valve spring', bucket: 'Spring bucket (tappet)' }[perCyl[1]];
    const side = perCyl[3] ? ` ${perCyl[3]}` : '';
    const station = c ? `station ${SPEC.block.stations[c.station]}, ${c.bank === 'L' ? 'left' : 'right'} bank, fire ${c.powerTDC}\u00b0` : '';
    return `${what} - cylinder ${perCyl[2]}${side} - ${station}`;
  }
  const cam = /^cam-([LR])-(intake|exhaust)$/.exec(name);
  if (cam) return `Camshaft - ${cam[1] === 'L' ? 'left' : 'right'} bank ${cam[2]} (half crank speed)`;
  const cover = /^cam-cover-([LR])-(intake|exhaust)$/.exec(name);
  if (cover) return `Cam cover - ${cover[1] === 'L' ? 'left' : 'right'} bank ${cover[2]}`;
  const head = /^head-([LR])$/.exec(name);
  if (head) return `Cylinder head - ${head[1] === 'L' ? 'left' : 'right'} bank`;
  const gasket = /^gasket-([LR])$/.exec(name);
  if (gasket) return `Head gasket - ${gasket[1] === 'L' ? 'left' : 'right'} bank`;
  const intake = /^intake-([LR])$/.exec(name);
  if (intake) return `Intake plenum - ${intake[1] === 'L' ? 'left' : 'right'} bank`;
  const header = /^headers-([LR])$/.exec(name);
  if (header) {
    const n = SPEC.block.stations.length;
    return `Exhaust headers (${n} into 1) - ${header[1] === 'L' ? 'left' : 'right'} bank`;
  }
  if (name === 'head-bolts') return 'Head bolts (both banks)';
  // The throw list is printed from SPEC.crank.pinAz, so the identity the part
  // reports is the geometry the renderer was actually built from.
  if (name === 'crank') {
    const az = SPEC.crank.pinAz.join('/');
    return `Crankshaft - ${SPEC.cylinders.length / 2}-cylinder V, ${SPEC.crank.pinAz.length} pins at ${az}\u00b0, twin rods per pin`;
  }
  if (name === 'flywheel') return 'Flywheel and ring gear';
  if (name === 'sprocket') return 'Cam drive sprocket (18 teeth -> cams turn at half crank)';
  if (/^main-cap-/.test(name)) return `Main bearing cap - station ${name.slice(9)}`;
  if (/^main-bolt-/.test(name)) return `Main cap bolts - station ${name.slice(10)}`;
  if (/^main-shell-/.test(name)) return `Main bearing shell - station ${name.slice(11)}`;
  if (/^main-bush-/.test(name)) return `Front/rear main bushing (${name.slice(10)})`;
  if (/^end-disc-/.test(name)) return `Block end disc (${name.slice(9)}) - the face the stand locates on`;
  if (name === 'oil-pan') return 'Oil pan (cast steel, on the pan rails)';
  if (name === 'pan-plug') return 'Oil drain plug';
  if (/^liner-cyl/.test(name)) return `Cylinder liner - cylinder ${name.slice(9)}`;
  if (/^column-/.test(name)) return `Bank support column (${name})`;
  if (/^web-/.test(name)) return `Block web (${name})`;
  if (name === 'crankcase') return 'Crankcase casting (the reference casting)';
  if (name === 'pan-rails') return 'Pan rail flange (cast integral with the block)';
  if (/^flange-bolts-/.test(name)) return `Header flange bolts - ${partBank(name) === 'L' ? 'left' : 'right'} bank`;
  return name;
}

// ------------------------------------------------------------------ framing ---
/**
 * The range at which a body of a given bounding-sphere radius just fits the
 * published frustum with margin. The vertical field is the tighter one at the
 * gate aspect, so the law uses it; bounding-sphere fitting is deliberately
 * conservative (a part is never cropped) and monotone (bigger body -> further
 * camera), which is what the tests assert.
 */
export function framingRange(radius, opts = {}) {
  const halfV = ((opts.fov ?? V.fov) / 2) * (Math.PI / 180);
  const halfH = Math.atan(Math.tan(halfV) * (opts.aspect ?? V.aspect));
  const tight = Math.min(halfV, halfH);
  const want = (radius / Math.sin(tight)) * (opts.margin ?? 1.15);
  const lo = opts.distMin ?? V.distMin;
  const hi = opts.distMax ?? V.distMax;
  return Math.min(hi, Math.max(lo, want));
}

/** Bounding-sphere radius of a world-space bbox given as {min:[x,y,z], max:[x,y,z]}. */
export function bboxRadius(box) {
  const r = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
  const c = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  return { radius: Math.hypot(r[0], r[1], r[2]) / 2, centre: c };
}
