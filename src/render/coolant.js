// Slice 8E (issue #8 addendum item 1, GATES row A1-G6): the DRAWN coolant assembly.
//
// Every mesh here is one published leg of src/engine/coolant.js: the mesh name is
// that leg's member name, its window is the `leg` the network publishes, and nothing
// in this file types a dimension. test/heads.test.mjs measures each drawn member back
// into the bank frame its leg is published in and compares it against the window, so
// the tree and the laws read one set of numbers.
//
// A coolant passage is a cavity, so it is drawn as the volume the casting does NOT
// have: a sharp-cornered solid (fillet 0 - a jacket is cast and a riser is bored, and
// neither leaves a fillet on the water) in its own material, standing exactly where
// the published window says. It is not a drilling drawn as a tube the way the oil ways
// are, because these ways are not drilled: the row claims cast jackets and bored
// risers, and SPEC.coolant.pending.drawnHoles says plainly that no coolant bore is
// machined into the drawn iron.
//
// What this file does NOT draw, and says so:
//   - a water pump, thermostat, radiator, hose route or drain: SPEC.coolant.pending
//     names each one, and nothing in SPEC models a pump drive or a temperature;
//   - coolant motion: createCoolant returns a static assembly and has no update();
//   - holes through the gasket or the deck: the block-to-head joint is the compressed
//     gasket band the published legs share a window across.
//
// Pinned by the "A1-G6 8E" laws in test/block.test.mjs, test/heads.test.mjs and
// test/view.test.mjs.
import * as THREE from 'three';
import { SPEC } from '../engine/spec.js';
import { coolantNetwork } from '../engine/coolant.js';
import { boxInBank } from './parts.js';

function volume(name, leg, bank, material, userData = {}) {
  const m = new THREE.Mesh(boxInBank(bank, leg.a0, leg.a1, leg.o0, leg.o1, leg.x0, leg.x1, 0), material);
  m.name = name;
  m.castShadow = false;
  m.receiveShadow = false;
  m.userData = { kind: 'coolant', ...userData };
  return m;
}

/**
 * The whole published network of one variant: jacket bands, deck risers in both
 * castings, the end links and the head end cross galleries.
 */
export function createCoolant(materials, variantId = SPEC.build.variant) {
  const net = coolantNetwork(variantId);
  const group = new THREE.Group();
  group.name = 'coolant';
  const tag = (extra = {}) => ({ variant: net.variant, ...extra });

  for (const j of net.jackets) {
    group.add(volume(j.member, j.leg, j.bank, materials.coolant, tag({ cast: j.cast, band: j.band, role: 'jacket' })));
  }
  for (const p of net.ports) {
    for (const L of p.legs) {
      group.add(volume(L.member, L.leg, p.bank, materials.coolant,
        tag({ cast: L.cast, band: p.band, role: 'riser', station: p.station ?? null, side: p.side ?? null })));
    }
  }
  for (const l of net.links) {
    group.add(volume(l.member, l.leg, l.bank, materials.coolant, tag({ cast: l.cast, band: l.band, role: 'link', side: l.side })));
  }
  for (const g of net.galleries) {
    group.add(volume(g.member, g.leg, g.bank, materials.coolant, tag({ cast: g.cast, role: 'gallery', side: g.side })));
  }
  return { group, counts: net.counts };
}
