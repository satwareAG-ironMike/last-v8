// The iron a water jacket may be cast in and the coolant passages may be bored
// through (issue #8 addendum item 1, GATES row A1-G6 slice 8E). This is the probe
// test/block.test.mjs, test/heads.test.mjs and test/view.test.mjs measure the
// published coolant network against - and, like test/support/oil-iron.mjs for the
// oil slice, it reads the DRAWN tree through the committed oracle instead of
// repeating the numbers it gates. Nothing here reads src/engine/coolant.js: a gate
// that asks the thing it gates where the iron is has no teeth.
//
// What a coolant volume is held to:
//   iron: every sample inside a passage leg reads iron in the casting it is bored
//     in, except the compressed gasket band between the two deck faces, which is
//     the one plane a passage crosses to get from block to head;
//   closure: iron also stands behind every face the network claims a wall on, for
//     the full thickness the row publishes - a cavity whose face opens into air is
//     not a closed jacket;
//   liner: the water stands the published cast land off the press-fit liner OD;
//   bore tunnel: the water stands a web off the machined cylinder bore;
//   oil: the water stands the published web off every bore the oil network drills;
//   head bolts: the water stands a web off the shank axis of each of the 32 drawn
//     head bolts, along the whole span the drawn bolt occupies.
import * as THREE from 'three';
import { SPEC, bankUp, bankOut } from '../../src/engine/spec.js';
import { oilNetwork } from '../../src/engine/oil.js';
import { oilOracle } from './oil-iron.mjs';

const B = SPEC.block;
const H = SPEC.head;

const toWorld = (frames, bank, x, a, o) =>
  frames[bank].out.clone().multiplyScalar(o).addScaledVector(frames[bank].up, a).setX(x);

const segDist = (p, s) => {
  const ab = s.b.clone().sub(s.a);
  const t = Math.max(0, Math.min(1, p.clone().sub(s.a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(s.a.clone().add(ab.multiplyScalar(t))) - s.r;
};

const grid = (lo, hi, step) => {
  const n = Math.max(1, Math.ceil((hi - lo) / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(lo + (hi - lo) * i / n);
  return out;
};

/**
 * @param net the table src/engine/coolant.js publishes (read, never retyped)
 * @param variantId 'dohc' or 'ohv'
 */
export function coolantProber(net, variantId = net.variant) {
  const C = SPEC.coolant;
  const oracle = oilOracle(variantId);
  const oil = oilNetwork(variantId);
  const bores = [oil.supply, ...oil.galleries, ...oil.camGalleries, ...oil.links, ...oil.bridges, ...oil.feeds]
    .filter((b) => b && Array.isArray(b.path) && b.path.length > 1);
  const segs = [];
  for (const b of bores) {
    for (let i = 0; i + 1 < b.path.length; i++) {
      segs.push({ id: b.id, r: b.drillR, a: new THREE.Vector3(...b.path[i]), b: new THREE.Vector3(...b.path[i + 1]) });
    }
  }
  const frames = {};
  for (const bank of ['L', 'R']) {
    frames[bank] = { up: new THREE.Vector3().fromArray(bankUp(bank)), out: new THREE.Vector3().fromArray(bankOut(bank)) };
  }

  /** The compressed gasket band: the one plane a block passage may cross. */
  const atDeck = (a, o) => a >= B.deckA - 1e-9 && a <= C.headFloorA + 1e-9
    && Math.abs(o) >= H.gasketId - 1e-9 && Math.abs(o) <= B.deckHalfWidth + 1e-9;

  /** Every leg of the published network, block and head legs alike. */
  const allLegs = () => {
    const out = [];
    for (const j of net.jackets) out.push({ ...j.leg, name: j.id, cast: j.cast, bank: j.bank });
    for (const p of net.ports) for (const L of p.legs) out.push({ ...L.leg, name: p.id, cast: L.cast, bank: p.bank });
    for (const l of net.links) out.push({ ...l.leg, name: l.id, cast: l.cast, bank: l.bank });
    for (const g of net.galleries) out.push({ ...g.leg, name: g.id, cast: g.cast, bank: g.bank });
    return out;
  };

  /** The face of a leg nearest / farthest from the bore axis it cools. */
  const faces = (leg) => ({
    floor: { key: 'a', at: leg.a0, dir: -1, claim: 'floor' },
    crown: { key: 'a', at: leg.a1, dir: +1, claim: 'crown' },
    inner: { key: 'o', at: Math.abs(leg.o0) < Math.abs(leg.o1) ? leg.o0 : leg.o1, dir: -Math.sign(Math.abs(leg.o0) < Math.abs(leg.o1) ? leg.o0 : leg.o1), claim: 'inner' },
    outer: { key: 'o', at: Math.abs(leg.o0) > Math.abs(leg.o1) ? leg.o0 : leg.o1, dir: -Math.sign(Math.abs(leg.o0) > Math.abs(leg.o1) ? leg.o0 : leg.o1), claim: 'outer' },
    x0: { key: 'x', at: leg.x0, dir: -1, claim: 'x0' },
    x1: { key: 'x', at: leg.x1, dir: +1, claim: 'x1' },
  });

  /** One sampled point inside a leg, judged. Returns an offender string or null. */
  const judge = (bank, leg, x, a, o) => {
    const w = toWorld(frames, bank, x, a, o);
    const c = oracle.classify([w.x, w.y, w.z]);
    const at = `a ${a.toFixed(2)} o ${o.toFixed(2)} x ${x.toFixed(2)}`;
    if (c.state !== 'iron' && !atDeck(a, o)) {
      return `${leg.name} [${leg.cast}]: sample at ${at} reads ${c.state}:${c.name ?? '-'}, not iron${atDeck(a, o) ? '' : ' and not at the deck interface'}`;
    }
    for (const s of B.stations) {
      const r = Math.hypot(x - s, o);
      if (r < B.boreRadius + C.tunnelWebCm) {
        return `${leg.name} [${leg.cast}]: sample at ${at} stands ${r.toFixed(4)} cm off the bore axis at station ${s}: the machined bore is ${B.boreRadius} cm and the row publishes a ${C.tunnelWebCm} cm web`;
      }
      if (r < C.linerOdCm + C.landCm) {
        return `${leg.name} [${leg.cast}]: sample at ${at} stands ${r.toFixed(4)} cm off the bore axis at station ${s}: the press-fit liner is ${C.linerOdCm} cm OD and the row publishes a ${C.landCm} cm cast land`;
      }
    }
    for (const s of segs) {
      const d = segDist(w, s);
      if (d < C.webCm) {
        return `${leg.name} [${leg.cast}]: sample at ${at} stands ${d.toFixed(4)} cm off the published oil bore ${s.id}: the row publishes a ${C.webCm} cm web between water and a drilling`;
      }
    }
    for (const s of B.stations) {
      for (const xo of [-H.boltXOff, H.boltXOff]) {
        for (const bo of [-H.boltOut, H.boltOut]) {
          if (a < C.boltA0Cm - 1e-9 || a > C.boltA1Cm + 1e-9) continue;
          const planar = Math.hypot(x - (s + xo), o - bo);
          if (planar < H.deckBoltRadius + C.boltWebCm) {
            return `${leg.name} [${leg.cast}]: sample at ${at} stands ${planar.toFixed(4)} cm off the head bolt axis at x ${(s + xo).toFixed(2)} o ${bo}: its shank is ${H.deckBoltRadius} cm and the row publishes a ${C.boltWebCm} cm web`;
          }
        }
      }
    }
    return null;
  };

  /** Every point inside one leg: bored in iron, clear of the hardware. */
  const legIron = (leg, step = 0.2) => {
    const offenders = [];
    let samples = 0;
    for (const a of grid(leg.a0, leg.a1, step)) {
      for (const o of grid(leg.o0, leg.o1, step)) {
        for (const x of grid(leg.x0, leg.x1, step)) {
          samples++;
          const hit = judge(leg.bank, leg, x, a, o);
          if (hit) offenders.push(hit);
        }
      }
    }
    return { samples, offenders };
  };

  /**
   * The iron behind one claimed face: `thickness` cm of iron must hold from the
   * face outward at every sample of that face. A sample whose walk-out point lies
   * in the deck interface or inside another published leg is skipped: those faces
   * are continuity joints, gated by the continuity law, not walls.
   */
  const faceClosed = (leg, walls, thickness, step = 0.02) => {
    const f = faces(leg)[walls];
    if (!f) return { samples: 0, offenders: ['unknown face'] };
    const keys = { a: ['o', 'x'], o: ['a', 'x'], x: ['a', 'o'] }[f.key];
    const span = keys.map((k) => grid(leg[k === 'a' ? 'a0' : k === 'o' ? 'o0' : 'x0'], leg[k === 'a' ? 'a1' : k === 'o' ? 'o1' : 'x1'], 0.5));
    const others = allLegs().filter((L) => L.name !== leg.name && L.bank === leg.bank);
    const offenders = [];
    let samples = 0;
    for (const u of span[0]) {
      for (const v of span[1]) {
        for (let d = step; d <= thickness + 1e-9; d += step) {
          const p = { a: leg.a0, o: leg.o0, x: leg.x0 };
          p[f.key] = f.at - f.dir * d; // the face normal points out of the cavity
          if (f.key === 'a') p.o = u, p.x = v;
          else if (f.key === 'o') p.a = u, p.x = v;
          else p.a = u, p.o = v;
          const joint = others.some((L) => p.a >= L.a0 - 1e-9 && p.a <= L.a1 + 1e-9 && p.o >= L.o0 - 1e-9 && p.o <= L.o1 + 1e-9 && p.x >= L.x0 - 1e-9 && p.x <= L.x1 + 1e-9);
          if (joint || atDeck(p.a, p.o)) break;
          samples++;
          const w = toWorld(frames, leg.bank, p.x, p.a, p.o);
          const c = oracle.classify([w.x, w.y, w.z]);
          if (c.state !== 'iron') {
            offenders.push(`${leg.name} [${leg.cast}] ${walls}: ${thickness.toFixed(2)} cm of iron claimed behind the face, ${d.toFixed(2)} cm out at a ${p.a.toFixed(2)} o ${p.o.toFixed(2)} x ${p.x.toFixed(2)} it reads ${c.state}:${c.name ?? '-'}`);
            break;
          }
        }
      }
    }
    return { samples, offenders };
  };

  return {
    variant: variantId,
    oracle,
    oil,
    frames,
    legs: allLegs,
    atDeck,
    legIron,
    faceClosed,
    toWorld: (bank, x, a, o) => toWorld(frames, bank, x, a, o),
  };
}

/**
 * The drawn box of a mesh, read back into the bank frame a leg is published in:
 * a law comparing a drawn member to its published window compares the same frame.
 */
export function legFrameBox(bank, mesh) {
  mesh.updateWorldMatrix(true, true);
  const up = new THREE.Vector3().fromArray(bankUp(bank));
  const out = new THREE.Vector3().fromArray(bankOut(bank));
  const p = mesh.geometry.attributes.position;
  const box = { a0: Infinity, a1: -Infinity, o0: Infinity, o1: -Infinity, x0: Infinity, x1: -Infinity };
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
    box.a0 = Math.min(box.a0, v.dot(up)); box.a1 = Math.max(box.a1, v.dot(up));
    box.o0 = Math.min(box.o0, v.dot(out)); box.o1 = Math.max(box.o1, v.dot(out));
    box.x0 = Math.min(box.x0, v.x); box.x1 = Math.max(box.x1, v.x);
  }
  return box;
}
