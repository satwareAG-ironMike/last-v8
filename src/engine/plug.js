// The spark-plug silhouette of SPEC.plug, expressed in bank-local `along` off the
// published seat plane PLUG_BOSS_A. What that plane is has to be stated plainly:
// PLUG_BOSS_A is head.stayTopA + plug.bossOff, i.e. the seat face is defined as an
// OFFSET FROM A PLANE (the top of the deck ribs the bucket towers stand on), not as
// a feature of the casting. src/render/heads.js casts no boss at `out` 0 there, so
// measured against the casting-only triangle shell the tallest material inside the
// hex's own 1.05 cm radius of its own axis stands at along 27.0782 cm - the machined
// spring-floor row - and the hex's seat face at 30.50 therefore hangs 3.4218 cm above
// it, with the nearest cast surface (a bucket-bore collar wall) 0.5961 cm from the
// nearest hex corner and 1.6381 cm from the axis itself at the seat plane. There is
// no seat face, no shoulder to locate the hex against and no material above the floor
// row for the thread to bear on. Issue #11 files that missing casting as its own
// defect; nothing here credits the plug with a feature the head does not have. This
// is the ONE implementation: the
// channel law in test/heads.test.mjs gaps it against the rendered casting, the
// plug laws in test/view.test.mjs measure the drawn meshes against it, and
// src/render/plugs.js builds those meshes from it. A silhouette measured twice in
// two files is a silhouette that can disagree, so nothing here is hand-copied:
// every radius, length and height comes out of SPEC.plug.
import { SPEC, PLUG_BOSS_A } from './spec.js';

const P = SPEC.plug;

/** Below the boss face the plug stands in the head and the chamber; above it, in air. */
const IN_HEAD = ['thread', 'shell', 'nose', 'electrode'];
const ABOVE = ['hex', 'boot', 'terminal'];

/**
 * Radius of one published segment at one height. A segment with a published
 * `rTip` tapers linearly from `r` at its top end to `rTip` at its bottom end,
 * which is how a ground insulator nose actually stands: widest where it enters
 * the bore mouth, narrowest at the tip.
 */
export function segRadius(seg, along) {
  if (seg.rTip === undefined) return seg.r;
  const f = (along - seg.a0) / (seg.a1 - seg.a0);
  return seg.rTip + (seg.r - seg.rTip) * f;
}

/** The published stack: every SPEC.plug segment, placed off PLUG_BOSS_A. */
export function plugStack() {
  const segs = [];
  let a = PLUG_BOSS_A;
  for (const name of IN_HEAD) {
    segs.push({ name, r: P[name].r, rTip: P[name].rTip, len: P[name].len, a0: a - P[name].len, a1: a });
    a -= P[name].len;
  }
  const bottom = a;
  a = PLUG_BOSS_A;
  for (const name of ABOVE) {
    segs.push({ name, r: P[name].r, rTip: P[name].rTip, len: P[name].len, a0: a, a1: a + P[name].len });
    a += P[name].len;
  }
  return { segs, bottom, top: a, bossA: PLUG_BOSS_A };
}

/**
 * The silhouette radius standing exactly AT this height: the widest segment that
 * covers it. No slop - a 0.1 cm tolerance here credits the plug with a radius it
 * does not have at that height, and this is a clearance measurement.
 */
export function stackRadius(segs, along) {
  let r = 0;
  for (const s of segs) {
    if (s.a0 - 1e-9 <= along && along <= s.a1 + 1e-9) r = Math.max(r, segRadius(s, along));
  }
  return r;
}

/**
 * Sample heights: every segment boundary (just inside each end) plus a grid
 * through the whole stack. Boundaries matter most - that is where the silhouette
 * changes radius, so a coarse grid walking past one misses the tightest gap.
 */
export function stackSamples(st, fineBelow, fineStep = 0.2, coarseStep = 0.4) {
  const hs = new Set();
  for (const s of st.segs) {
    hs.add(+(s.a0 + 0.05).toFixed(3));
    hs.add(+(s.a1 - 0.05).toFixed(3));
  }
  for (let a = st.bottom; a <= st.top + 1e-9; a += (a < fineBelow ? fineStep : coarseStep)) {
    hs.add(+a.toFixed(3));
  }
  return [...hs].sort((x, y) => x - y);
}

/**
 * The silhouette is a stack of solids of revolution: the radius a segment has at
 * one of its own ends is `segRadius` evaluated at that end, which is the same
 * function the clearance laws read - so the drawn plug and the measured plug take
 * their radius from one definition, not from two.
 */
export const segEndRadius = (seg, end) => segRadius(seg, end === 'top' ? seg.a1 : seg.a0);
