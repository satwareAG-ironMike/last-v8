// The spark-plug silhouette of SPEC.plug, expressed in bank-local `along` off the
// machined plug-boss face. One implementation, read by the channel law in
// test/heads.test.mjs (which gaps it against the rendered casting) and by
// src/render/plugs.js (which draws it), so the plug a gate measures and the plug
// the page shows are the same published numbers - a silhouette measured twice in
// two files is a silhouette that can disagree.
import { SPEC, PLUG_BOSS_A } from '../../src/engine/spec.js';

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
