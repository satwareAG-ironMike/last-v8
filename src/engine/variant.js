// The one door a build variant enters this shell through (issue #16, decision 2C).
//
// Every render factory already takes a variant id and every layout authority derives
// from SPEC.build.variant, but until now nothing ever wrote that field: src/main.js
// called the factories with their defaults, so the OHV build existed in the engine
// modules, in the laws and in no scene. Two ways in, one authority behind both:
//
//   variantFromSearch - what the page address asks for, and what this tree answers
//   setVariant        - the write every caller goes through, so the switch is one
//                       published fact and not a field each caller pokes
//   shellDatums       - the cell planes the shell draws and guards against, for the
//                       build it is actually drawing
//
// The cell floor is not a constant this shell may reuse. layout.js standDatums(id)
// shifts the whole stand by the depth the variant's own skirt reaches (OHV: -3.2000 cm)
// and src/render/stand.js already builds its feet on that shifted plane; a camera guard
// or an explode hoist that reads SPEC.stand.floorZ instead is standing inside the
// casting it is meant to keep clear of the floor plate.
import { SPEC } from './spec.js';
import { standDatums, variantEntry } from './layout.js';

/** The query parameter the address read answers. Published so the panel control, the
 * screenshot harness and a reader all name the same word. */
export const VARIANT_PARAM = 'variant';

/**
 * What the page address asks for.
 *
 * No parameter: the build this tree is already drawing. An unpublished value: the same
 * build, plus `rejected` naming what was asked for - a silent fallback is how a mistyped
 * address ends up looking like the build the reader wanted.
 *
 * @param {string} search location.search, or any '?a=b' string
 * @returns {{id: string, source: 'url' | 'default', rejected: string | null}}
 */
export function variantFromSearch(search = '') {
  const asked = new URLSearchParams(search).get(VARIANT_PARAM);
  if (asked === null) return { id: SPEC.build.variant, source: 'default', rejected: null };
  if (Object.prototype.hasOwnProperty.call(SPEC.variants, asked)) {
    return { id: asked, source: 'url', rejected: null };
  }
  return { id: SPEC.build.variant, source: 'default', rejected: asked };
}

/**
 * Write the switch. The published entry is returned so a caller can name what it chose,
 * and an id SPEC.variants does not publish throws naming the list instead of guessing.
 */
export function setVariant(id) {
  const entry = variantEntry(id);
  SPEC.build.variant = entry.id;
  return { ...entry };
}

/**
 * The planes the shell keeps its hardware off, for the build it is drawing: the stand
 * datum this variant's casting sits on, and the eye plane derived from it. Every guard
 * in src/ui/cameraRig.js and src/engine/view.js reads this instead of SPEC.stand, which
 * is one variant's numbers remembered as a constant.
 */
export function shellDatums(id = SPEC.build.variant) {
  const d = standDatums(id);
  return { ...d, eyeFloorZ: d.floorZ + SPEC.view.eyeMin };
}
