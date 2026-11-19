// The eight spark plugs. One published silhouette (src/engine/plug.js) on each of
// the eight published cylinder axes (SPEC.cylinders / SPEC.block.stations), built
// from the same segment table the machined channel in test/heads.test.mjs is
// measured against, so the plug a gate measures and the plug the page shows are
// one set of numbers. update(theta, advance) writes the additive tip glow through
// firingProgress(cyl, theta, advance): the flash opens at the spark instant
// (powerTDC - total advance), runs through power TDC and closes burnDeg after it,
// and is dark everywhere else. Nothing here is a second copy of a published number.
//
// The glow is a sphere of SPEC.plug.glowR standing on the spark gap - the published
// bottom of the stack - because that is where the arc jumps. SPEC.plug names the
// radius and states why it is derived from the poses the plug is LIT at rather than
// from the whole cycle.
//
// Pinned by test/view.test.mjs section 13 (row P1-G5, issue #11).
import * as THREE from 'three';
import { SPEC, bankPoint, bankUp } from '../engine/spec.js';
import { firingProgress } from '../engine/timing.js';
import { plugStack, segEndRadius } from '../engine/plug.js';
import { alignYTo } from './primitives.js';

const P = SPEC.plug;
const B = SPEC.block;

/** The insulator is ceramic; everything else on a plug is turned or plated steel. */
const CERAMIC = ['nose', 'boot'];
/**
 * The hex is the one segment that is not a revolution: its published 1.05 is the
 * corner radius of a six-sided prism, i.e. 1.819 cm across flats. Drawn as a
 * 6-gon so its corners land on the published radius instead of a circle bulging
 * past the flats the channel was machined for.
 */
const HEX_SIDES = 6;
/** Even widthSegments (divisible by 4) and even heightSegments: a UV sphere whose
 * vertices actually reach +-radius on all three axes, which is what the glow law
 * measures the drawn glow against. */
const GLOW_SEG = { width: 24, height: 16 };

function mesh(name, geometry, material, kind, userData = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData = { kind, ...userData };
  return m;
}

/** A cone (or cylinder) about the bore axis, centred on its own mid-height. */
function segmentSolid(bank, seg, x) {
  const rTop = segEndRadius(seg, 'top');
  const rBot = segEndRadius(seg, 'bottom');
  const sides = seg.name === 'hex' ? HEX_SIDES : 24;
  const g = new THREE.CylinderGeometry(rTop, rBot, seg.a1 - seg.a0, sides, 1);
  g.applyQuaternion(alignYTo(new THREE.Vector3().fromArray(bankUp(bank))));
  const mid = (seg.a0 + seg.a1) / 2;
  const p = bankPoint(bank, mid, 0, x);
  g.translate(p.x, p.y, p.z);
  return g;
}

/**
 * @returns {{group:THREE.Group, update:(theta:number, advance:number)=>void,
 *            plugs:Array<{cyl:number, pose:object, group:THREE.Group, flash:THREE.Mesh}>}}
 */
export function createPlugs(materials) {
  const group = new THREE.Group();
  group.name = 'plugs';
  const st = plugStack();
  const plugs = [];

  for (const cyl of SPEC.cylinders) { // one plug per published axis, count read live
    const x = B.stations[cyl.station];
    const holder = new THREE.Group();
    holder.name = `plug-cyl${cyl.num}`;
    holder.userData = { kind: 'spark plug', cyl: cyl.num, bank: cyl.bank };

    for (const seg of st.segs) {
      const mat = CERAMIC.includes(seg.name) ? materials.ceramic : materials.fastenerSteel;
      const m = mesh(
        `plug-cyl${cyl.num}-${seg.name}`,
        segmentSolid(cyl.bank, seg, x),
        mat,
        'spark plug',
        { cyl: cyl.num, bank: cyl.bank, segment: seg.name }
      );
      holder.add(m);
    }

    // The tip glow. Its own material, cloned per plug and named per plug: the
    // cutaway builds its private clones keyed on the material NAME (src/ui/
    // viewControls.js sectionClone), so eight plugs sharing one material object or
    // one name would share one opacity - every plug would light when any one fires.
    const glow = materials.spark.clone();
    glow.name = `spark-cyl${cyl.num}`;
    const gap = bankPoint(cyl.bank, st.bottom, 0, x);
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(P.glowR, GLOW_SEG.width, GLOW_SEG.height),
      glow
    );
    flash.name = `plug-cyl${cyl.num}-flash`;
    flash.position.set(gap.x, gap.y, gap.z);
    flash.castShadow = false; // an additive glow is light: it must not shade anything
    flash.receiveShadow = false;
    flash.userData = { kind: 'spark glow', cyl: cyl.num, bank: cyl.bank };
    holder.add(flash);

    group.add(holder);
    plugs.push({ cyl: cyl.num, group: holder, flash, pose: cyl });
  }

  /**
   * Pose the eight tips at one crank angle. The opacity is written through
   * mesh.material, never a captured reference: CUTAWAY swaps every engine mesh
   * onto a private sectioned clone, and a glow held on the material it was built
   * with would keep fading on a material nobody is drawing.
   */
  const update = (theta, advance) => {
    for (const p of plugs) {
      const progress = firingProgress(p.pose, theta, advance);
      p.flash.material.opacity = progress < 0 ? 0 : 1 - progress;
    }
  };

  return { group, update, plugs, stack: st };
}
