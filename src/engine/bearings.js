// The cam bearing stack, derived from the one published wall set in
// SPEC.cam.bearing (issue #8 addendum item 4, GATES A1-G7).
//
// A line-bored cam tunnel is built outside-in: the cam journal, an oil film, a
// replaceable shell, the casting wall, then the tab the cap bolt stands on. Only
// the walls are published; every radius, the bolt line and the nose clearance come
// from them. That is what makes the tunnel manufacturable: the bore is machined to
// the shell's outside, the shell is bought to the journal plus a film, and the
// crank-side halves are machined in one setting against one cutter.
//
// The stack deliberately does NOT publish a clearance between the cam and a cast
// bore: the running clearance is the oil film under a shell, not a number typed
// next to a bore. SPEC.cam.bearingR stays the published LINE BORE - the two head
// halves are bored to exactly that radius and the shell fills it.
import { SPEC } from './spec.js';

const H = SPEC.head;
const CAM = SPEC.cam;
const B = CAM.bearing;

/** The cam's own ground journal radius (SPEC.head.camJournalRadius). */
export const journalR = H.camJournalRadius;
/** Inside of the shell: the journal plus the hydrodynamic film it rides on. */
export const shellIdR = journalR + B.oilFilm;
/** The line bore: what both head halves are machined to. Equals SPEC.cam.bearingR. */
export const boreR = shellIdR + B.shellWall;
/** Outside of the head casting around the bore. */
export const castOdR = boreR + B.castWall;
/** Outside of the bolt tab, which stands off the casting and has to clear the nose. */
export const tabR = castOdR + B.tabStand;
/** Where a cap bolt stands: mid of the tab span, one bolt each side of the bore. */
export const boltOutRel = (boreR + tabR) / 2;
/** Circumscribed radius of the cap bolt head, from the published across-flats. */
export const boltCircumR = B.boltAcrossR / Math.cos(Math.PI / 6);
/**
 * The cast cam bearing housing wall each column stands on. A cap bolt is turned from
 * under the cover, so the wall has to stand past the hex by the published wrench
 * clearance - a wall inside that line blocks the socket - and its top face at
 * CAP_TOP is the cam cover seating plane.
 */
export const housingInRel = boltOutRel + boltCircumR + B.wrenchClr;
export const housingOutRel = housingInRel + B.housingWall;
/** Half width of a tab along the cam axis: inset from the bearing width. */
export const tabHalf = CAM.bearingHalf - B.tabInset;
/** A cap bolt runs from the top of the cap tab down through the cradle tab. */
export const boltLen = 2 * B.tabH;
/** The tallest thing a cam carries: base circle plus full lift. */
export const noseR = H.camBaseRadius + SPEC.valves.maxLift;

/**
 * Azimuth of the radial oil way in each half, in the split-plane convention the
 * laws measure in: psi = atan2(out, along), psi 0 crown-ward, 180 deck-ward.
 */
export const oilAz = B.oilAz;

/** The whole stack as one object, for HUD/inspectables and for the laws. */
export function bearingStack() {
  return {
    journalR, oilFilm: B.oilFilm, shellIdR, shellWall: B.shellWall, boreR,
    journalR, oilFilm: B.oilFilm, shellIdR, shellWall: B.shellWall, boreR,
    castWall: B.castWall, castOdR, tabStand: B.tabStand, tabH: B.tabH,
    tabInset: B.tabInset, tabR, tabHalf,
    boltOutRel, boltHoleR: B.boltHoleR, boltAcrossR: B.boltAcrossR, boltCircumR, boltLen,
    wrenchClr: B.wrenchClr, housingWall: B.housingWall, housingInRel, housingOutRel,
    shellBandHalf: B.shellBandHalf, oilBandDeg: B.oilBandDeg,
    oilHoleR: B.oilHoleR, oilAz, noseR,
    runningClearance: shellIdR - journalR,
    metalToCam: boreR - journalR,
    tabHalfSpan: (tabR - boreR) / 2,
  };
}
