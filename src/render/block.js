// The cross-plane V8 block casting as a union of primitives. Overlapping
// solids in the same material render as one casting; every junction is
// computed from src/engine/spec.js plus the build switch (src/engine/layout.js)
// and pinned by test/block.test.mjs.
//
// Solids: crankcase drum shell, fore/aft end discs (with main bearing
// holes + bushes + shells), outboard deck support columns, inboard bridge
// webs, bore liners, interior main cap towers, pan rails, oil pan.
// Rule: crank counterweights swing only inside |x| < SPEC.block.counterBayHalfX
// at r <= SPEC.crank.counterRadius, so they clear the towers and end discs.
//
// The build switch changes ONE solid here plus the planes the sump bolts on:
// the DOHC drum is a plain OD/ID lathe, the OHV drum is the same drum with the
// wall its bored cam tunnel cuts through machined away, cast in one piece with
// the skirt that carries the machined tunnel floor (A1-G7 / issue #16).
import * as THREE from 'three';
import {
  SPEC,
  OD,
  ID,
  supportColumn,
  mainCapLug,
  MAIN_CAPS_X,
  idHalfDepth,
  endDiscFaceX,
  bankUp,
  bankOut,
} from '../engine/spec.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ohvBearings, ohvHousing, ohvLifterGallery, panPlanes, variantEntry } from '../engine/layout.js';
import { oilNetwork } from '../engine/oil.js';
import { boxInBank, worldBox, latheX, latheBank, machinedArc, machinedCircle } from './parts.js';
import { alignX, circleHole, extrude } from './primitives.js';

const B = SPEC.block;
const CR = SPEC.crank;
const LINER_OD = B.boreShellRadius + B.linerWallCm; // slips into the bore wall columns
const X_FRONT = B.stations[0] + B.pitch / 2; // 22
const X_REAR = B.stations[3] - B.pitch / 2; // -22
const SHELL_IN = CR.mainRadius + SPEC.oil.mainShell.filmCm; // bearing shell inner
const SHELL_OUT = SPEC.block.mainSeat.boreCm; // 3.45: the seat the block bores IS this shell's OD
const PLUG_IN = 0.2; // how far a drain plug reaches up into the sump it screws into

/** Closed outer-first lathe profile for a ring about world X. */
function ringX(rOut, rIn, x0, x1) {
  return [
    [rOut, x0],
    [rOut, x1],
    [rIn, x1],
    [rIn, x0],
    [rOut, x0],
  ];
}

/**
 * A1-G4 / issue #8 item 5 (slice 8D-2b): a bearing ring machined with its own
 * radial oil drilling, built the way src/render/heads.js machines the 56 DOHC
 * cam shells. An axially bored ring cannot carry a radial through-hole at all -
 * a notch in an axially bored outline would cut the ring in half instead of
 * drilling it - so the ring is bored in bands: the two end bands are turned
 * rings, the band a drilling stands in is machined as radial cuts whose own
 * extrusion direction IS the drilling direction. No boolean geometry exists in
 * this repo, exactly as in heads.js.
 *
 * psi is measured about world X from +y toward +z, the convention these rings
 * are bored at. Each cut's corner is compensated onto the published OD: the cut
 * is bored from rFace = sqrt(rOut^2 - halfTang^2), so the ring keeps its
 * published band and the machined face stands the sagitta inside it.
 */
const OIL_CUT_RATIO = 0.7; // one cut's azimuth half width against the ring's own angular step
const OIL_BAND_HALF = 0.4; // axial half width of the band a drilling is machined in
const DEG = Math.PI / 180;
const XHAT = new THREE.Vector3(1, 0, 0);
const forMerge = (g) => (g.index ? g.toNonIndexed() : g);

/** An annulus sector about world X, bored along X: the band a drilling is not in. */
function arcRingX(rIn, rOut, psi0, psi1, x0, x1, segs) {
  const span = psi1 - psi0;
  const at = (r, psi) => [r * Math.cos(psi * DEG), r * Math.sin(psi * DEG)]; // [y, z]
  const pts = [];
  for (let i = 0; i <= segs; i++) pts.push(at(rOut, psi0 + (span * i) / segs));
  for (let i = 0; i <= segs; i++) pts.push(at(rIn, psi1 - (span * i) / segs));
  const shape = new THREE.Shape();
  pts.forEach(([y, z], i) => (i ? shape.lineTo(y, z) : shape.moveTo(y, z)));
  shape.closePath();
  const g = extrude(shape, x1 - x0, { bevel: 0, curveSegments: 1 });
  g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), XHAT));
  g.translate((x0 + x1) / 2, 0, 0);
  return g;
}

/**
 * One radial cut of a bearing ring: a slab extruded ALONG the radial direction,
 * so a circle in its outline is a radial through-drill rather than a notch.
 * (X, d x X, d) is a right-handed basis for a radial d standing off world X,
 * which is what keeps every face outward - the same handedness rule heads.js
 * radialFacet follows.
 */
function radialCutX(bx, psi, rIn, rFace, halfAxial, cutDeg, drillR) {
  const halfTang = Math.sin(cutDeg * DEG) * ((rIn + rFace) / 2);
  const d = new THREE.Vector3(0, Math.cos(psi * DEG), Math.sin(psi * DEG));
  const tang = d.clone().cross(XHAT);
  const shape = new THREE.Shape();
  const pts = [[-halfAxial, -halfTang], [halfAxial, -halfTang], [halfAxial, halfTang], [-halfAxial, halfTang]];
  pts.forEach(([a, b], i) => (i ? shape.lineTo(a, b) : shape.moveTo(a, b)));
  shape.closePath();
  if (drillR > 0) shape.holes.push(circleHole(0, 0, drillR, false));
  const g = extrude(shape, rFace - rIn, { bevel: 0, curveSegments: 14 });
  g.applyMatrix4(new THREE.Matrix4().makeBasis(XHAT, tang, d));
  const off = new THREE.Vector3(bx, 0, 0).addScaledVector(d, (rIn + rFace) / 2);
  g.translate(off.x, off.y, off.z);
  return g;
}

/**
 * The full ring a bearing shell is: turned at its two end bands, bored the long
 * way around the middle band, and machined with three radial cuts across the
 * published oil azimuth - the centre one carrying the drilling. The cuts cover
 * past the arc's gap at every radius of the band, so the only opening left in
 * the wall is the drilled hole itself.
 */
function drilledRingX(rIn, rOut, x0, x1, psiWay, drillR, turnedSegs) {
  const stepDeg = 360 / turnedSegs; // the ring's own angular step: 9 deg at 40 facets
  const cutDeg = OIL_CUT_RATIO * stepDeg;
  const bx = (x0 + x1) / 2;
  const mid = Math.min(OIL_BAND_HALF, (x1 - x0) / 2 - 0.2);
  const halfTang = Math.sin(cutDeg * DEG) * ((rIn + rOut) / 2);
  const rFace = Math.sqrt(rOut ** 2 - halfTang ** 2); // the cut's corner lands on the OD
  return mergeGeometries([
    latheX(ringX(rOut, rIn, x0, bx - mid), turnedSegs),
    latheX(ringX(rOut, rIn, bx + mid, x1), turnedSegs),
    arcRingX(rIn, rOut, psiWay + stepDeg, psiWay + 360 - stepDeg, bx - mid, bx + mid, turnedSegs - 2),
    radialCutX(bx, psiWay, rIn, rFace, mid, cutDeg, drillR),
    radialCutX(bx, psiWay - stepDeg, rIn, rFace, mid, cutDeg, 0),
    radialCutX(bx, psiWay + stepDeg, rIn, rFace, mid, cutDeg, 0),
  ].map(forMerge), false);
}

/**
 * A1-G7 / issue #16: the OHV casting as machined YZ sections, one per x band.
 * The bored cam tunnel cuts clean through the bottom of the drum wall AND through
 * the fore and aft end walls, so every one of them gives up the iron the boring
 * bar takes; the casting is completed by the skirt that carries the machined
 * tunnel floor - whose own bottom face is this variant's pan-rail plane.
 *
 * Section (y, z), every radius, face and arc read from ohvHousing():
 *   outer contour  - the skirt bottom face, up the skirt sides onto the OD circle
 *                    at the derived corners, then the retained OD arc the long way
 *                    over the top;
 *   the drum void  - the crankcase hole UNION the bored tunnel hole: the retained
 *                    ID arc the long way over the top plus the bored arc the long
 *                    way past the tunnel floor;
 *   the end walls  - the same contour, bored for the cam tunnel and for the main
 *                    bearing bore they close. The fore one is the opening the cam
 *                    nose and its drive stand in, the aft one the bore the cam's
 *                    aft journal turns in - the front-insert tunnel A1-G7 names.
 * The bore IS a machined face of these solids, so the casting can never stand
 * closer to the cam than the published lobe air (tmp/ohvdrum.mjs proves the drum
 * section against the analytic material predicate and as a real signed solid).
 */
// alignX maps shape (u, v) onto world (y, z) as u = -z, v = y
const toShape = ([y, z]) => [-z, y];
const trace = (Path, pts) => {
  Path.moveTo(...toShape(pts[0]));
  for (let i = 1; i < pts.length; i++) Path.lineTo(...toShape(pts[i]));
  Path.closePath();
};

/** the outer contour every OHV section of this casting shares */
function ohvOuter(H) {
  const A = H.arcs;
  return [
    [H.skirtHalfY, H.skirtZ],
    ...machinedArc(0, 0, OD, A.skirtSide[0], A.skirtSide[1], H.arcStepRad),
    [-H.skirtHalfY, H.skirtZ],
  ];
}

/** one x band of the casting: the shared contour with each closed void bored out */
function ohvSection(H, holes, x0, x1) {
  const shape = new THREE.Shape();
  trace(shape, ohvOuter(H));
  for (const hole of holes) {
    const path = new THREE.Path();
    trace(path, hole);
    shape.holes.push(path);
  }
  const g = alignX(extrude(shape, x1 - x0, { bevel: 0, curveSegments: 1 }));
  g.translate((x0 + x1) / 2, 0, 0); // the same station-slab span as the DOHC drum
  g.computeVertexNormals();
  return g;
}

function ohvCrankcase(H) {
  const A = H.arcs;
  const voidWall = machinedArc(0, 0, ID, A.voidWall[0], A.voidWall[1], H.arcStepRad);
  const boreFloor = machinedArc(0, -H.belowCrankCm, H.tunnelBoreR, A.boreFloor[0], A.boreFloor[1], H.arcStepRad);
  return ohvSection(H, [[...voidWall, ...boreFloor].reverse()], X_REAR, X_FRONT);
}

/** a fore or aft end wall: closed around the bay, bored for main bearing and cam */
function ohvEndWall(H, x0, x1, mainBoreR) {
  const cam = machinedCircle(0, -H.belowCrankCm, H.tunnelBoreR, H.arcStepRad);
  const main = machinedCircle(0, 0, mainBoreR, H.arcStepRad);
  return ohvSection(H, [cam, main], x0, x1);
}

/**
 * A1-G6 / issue #16 option B (slice 8C-3a): one piece of one bank's gallery rib.
 *
 * A rib is machined ALONG the lifter axis (parallel to this bank's cylinder
 * bores, through the cam axis), so the two lifter bores it carries are holes
 * bored through the iron the rib is cast as - the same hole-path idiom
 * ohvEndWall bores its cam tunnel with. The outline is the published cast wall
 * outside each bore, and the relief the crank-side room demands is not a pad
 * under the rib: it is the rib's own inboard face.
 *
 * The room does not stop at the bore, it also eats the iron the bore stands in.
 * The published wall outside the bore (ribIn) stays clear of the room only up to
 * the station where the room's arc crosses it (stepT), so each rib is two prisms
 * machined against the same bore: the mouth block from the machined tunnel face
 * to that station at the full cast wall, and the guide wall from there to the
 * guide's outboard end, standing on the room's own arc (wallIn). They share the
 * plane stepT and the bore runs through both, and the rib's outboard face reaches
 * past the crankcase void wall ID at the mouth - that is what ties the gallery
 * into the casting.
 */
function ohvGalleryRib(G, bank, cluster, span, inFace, name) {
  const g = G.banks[bank];
  const sgn = SPEC.banks[bank].outSign;
  const up = bankUp(bank);
  const outv = bankOut(bank);
  const ribOut = g.axisOut + G.boreRadius + G.castWallCm;
  const [x0, x1] = cluster;
  const shape = new THREE.Shape();
  shape.moveTo(x0, sgn * inFace);
  shape.lineTo(x1, sgn * inFace);
  shape.lineTo(x1, sgn * ribOut);
  shape.lineTo(x0, sgn * ribOut);
  shape.closePath();
  const bored = g.bores.filter((b) => b.x >= x0 && b.x <= x1);
  for (const b of bored) shape.holes.push(circleHole(b.x, sgn * g.axisOut, G.boreRadius));
  const geo = extrude(shape, span[1] - span[0], { bevel: 0, curveSegments: 24 });
  geo.translate(0, 0, g.axisAlong + (span[0] + span[1]) / 2); // local z is `along`
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, sgn * outv[1], sgn * outv[2]),
    new THREE.Vector3(0, up[1], up[2])
  ));
  geo.computeVertexNormals();
  return { geo, bored, name };
}

/**
 * A1-G7 / issue #18 ask 3 (slice 8C-3d): one central main support, cast on its flat top
 * plane and then BORED at the published seat radius about the crank axis.
 *
 * The support used to end on a flat top standing INSIDE the bearing shell's own bore: the
 * shell is a full ring at SHELL_OUT 3.4500 whose lowest face is z -3.4500, while the support
 * top plane stood at z -3.3500, so cast iron crossed the bore over |y| <= 0.8246 - 0.1000 cm
 * of the shell's own bearing seat occupied by the casting that is supposed to locate it
 * (issue #18 Measured 1). Machining the bore takes exactly that iron out: the support now
 * carries the shell on a machined arc at the published radius, and the flat top survives
 * only as the shoulder the boring bar leaves the iron through. Nothing is added anywhere -
 * the section is the old outline with the bore disc taken out of it.
 *
 * The contour is traced in (y, z) and machined through the same alignX/extrude idiom
 * ohvSection and ohvEndWall machine their bored faces with, at the same published arc step.
 */
function mainSupport(x0, x1, y0, y1, bottom, top) {
  const R = SPEC.block.mainSeat.boreCm;
  const step = (SPEC.variants.ohv.tunnel.arcStepDeg * Math.PI) / 180;
  const zTop = -top; // the cast top plane, below the crank axis
  const cross = Math.sqrt(R * R - top * top); // where the bore circle meets that plane
  const pts = [[y0, bottom], [y1, bottom]];
  if (y1 > -cross && y0 < cross) {
    // The bore reaches this support. Where the support's own edge stands INSIDE the
    // crossing window, that edge stops at the circle, not at the cast top plane: the
    // iron is gone above it. Where the edge stands outboard of the window, the flat
    // cast top runs all the way to the crossing point and the boring bar leaves the
    // iron through that shoulder.
    const inA = y0 > -cross;
    const inB = y1 < cross;
    const pA = inA ? [y0, -Math.sqrt(R * R - y0 * y0)] : [-cross, zTop];
    const pB = inB ? [y1, -Math.sqrt(R * R - y1 * y1)] : [cross, zTop];
    pts.push([y1, pB[1]]);
    if (!inB) pts.push(pB);
    pts.push(...machinedArc(0, 0, R, Math.atan2(pA[1], pA[0]), Math.atan2(pB[1], pB[0]), step).reverse());
    if (!inA) pts.push([y0, zTop]); // the arc ends ON the circle only where the support
    // edge stands inside the crossing window; outboard of it the flat cast top runs on.
  } else {
    pts.push([y1, zTop], [y0, zTop]); // this support is outboard of the bore: flat cast top
  }
  const shape = new THREE.Shape();
  trace(shape, pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-9));
  const g = alignX(extrude(shape, x1 - x0, { bevel: 0, curveSegments: 1 }));
  g.translate((x0 + x1) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

export function createBlock(materials, variantId = SPEC.build.variant) {
  const variant = variantEntry(variantId);
  const P = panPlanes(variantId); // the bolt planes THIS variant casts
  const OILNET = oilNetwork(variantId); // the ways this variant's bearings are fed, and
  // the azimuth each carrier has to be drilled at so its own feed can enter it (8D-2b)
  const H = variant.centralCam ? ohvHousing() : null;
  const group = new THREE.Group();
  group.name = 'block';

  const put = (part, geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = part;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.part = part;
    m.userData.solid = true;
    group.add(m);
    return m;
  };

  // 1. crankcase drum shell: OD/ID annulus spanning the four station slabs.
  //    The OHV variant machines the wall band its bored cam tunnel cuts through
  //    out of that annulus and casts its skirt onto the same solid.
  put('crankcase', H ? ohvCrankcase(H) : latheX(ringX(OD, ID, X_REAR, X_FRONT), 72), materials.castIronBlock);

  // 2. fore + aft end discs with main bearing holes, bushes and shells. The OHV
  //    build bores its cam tunnel through these walls too: the bar runs straight
  //    through the casting, so the wall it meets gives up that iron as well.
  put(
    'end-disc-fore',
    H
      ? ohvEndWall(H, X_FRONT, X_FRONT + B.slabFront, B.mainBossR)
      : latheX(ringX(OD, B.mainBossR, X_FRONT, X_FRONT + B.slabFront), 64),
    materials.castIronBlock
  );
  put(
    'end-disc-aft',
    H
      ? ohvEndWall(H, X_REAR - B.slabRear, X_REAR, B.aftMainBossR)
      : latheX(ringX(OD, B.aftMainBossR, X_REAR - B.slabRear, X_REAR), 64),
    materials.castIronBlock
  );
  const foreBush = B.mainBossR + 0.1;
  const aftBush = B.aftMainBossR + 0.1;
  put('main-bush-fore', latheX(ringX(foreBush, SHELL_OUT - 0.05, 23.4, 25.6), 48), materials.castIronBlock);
  put('main-bush-aft', latheX(ringX(aftBush, SHELL_OUT - 0.05, -25.6, -23.4), 48), materials.castIronBlock);

  // 2b. A1-G7 / issue #8 addendum item 4 (slice 8B): the bearings this variant's
  //     cam runs in. The face the drum and both end walls are bored to IS this
  //     variant's line bore, so every bushing is a full-round front-insert ring
  //     whose OUTSIDE face is that bore - the same press fit the cylinder liners
  //     use, and the bore is cut with the bushings in place, which is what makes
  //     them captive. The fore ring abuts the retainer, the aft ring the aft end
  //     wall; the through-bore is the same cylinder at every window, so the three
  //     mid rings are captured by the cam's own locating collars (slice 8C draws
  //     that cam and owes them). Each ring's oil way is a machined drilling and
  //     is machined with the oil system it feeds (A1-G4).
  if (H) {
    const G = ohvBearings();
    for (let i = 0; i < G.windows.length; i++) {
      const [a, b] = G.windows[i];
      const name = `cam-bushing-${i + 1}`;
      const feed = OILNET.feeds.find((f) => f.part === name);
      // A1-G4 / issue #8 item 5 (slice 8D-2b): this front-insert shell is the one
      // carrier in this tree whose drilling is NOT machined yet. Its bore is turned
      // at the 48-facet resolution test/ohv-cam.test.mjs law "the drawn journal
      // rides the drawn front-insert rings on exactly the published oil film"
      // measures the running clearance against (src/engine/ohv.js TURNED_SEGMENTS),
      // and a 0.1000 cm drill in a 3.1400 cm bore opens only
      // asin(0.1000/3.4000) = 1.6905 deg of azimuth: drilling this ring would put
      // the opening's own facets 1.7 deg apart against the bore's 7.5000 deg grid.
      // The way is published and drawn (bore oil-cam-ohv-*, the azimuth is feed.az
      // below) and the clause is named in SPEC.oil.pending.drawnHoles.open; the
      // options are on issue #8.
      const ring = latheX(ringX(G.boreR, G.shellIdR, a, b), 48);
      ring.translate(0, 0, -H.belowCrankCm); // the ring turns about the CAM axis, not the crank's
      const bush = put(name, ring, materials.bearingShell);
      if (feed) bush.userData.oilAz = [feed.az]; // where its oil way has to be machined
    }

    // the retainer: the front-insert cap A1-G7 names for this variant. It stands
    // proud of the machined fore face over the loaded half of the mouth - from
    // the published rail plane up to the cam axis, the split plane every bearing
    // cap in this tree splits at - and its opening is the shell inside, so the
    // whole cam and every lobe nose slide through it on the way in. Nothing of
    // the casting reaches this far fore, so the plate bridges the mouth instead
    // of standing inside it.
    const plate = new THREE.Shape();
    const mouth = machinedArc(0, -H.belowCrankCm, G.plateInR, Math.PI, 2 * Math.PI, H.arcStepRad);
    trace(plate, [
      [-G.plateHalfY, G.plateBottomZ],
      [-G.plateHalfY, G.plateTopZ],
      ...mouth,
      [G.plateHalfY, G.plateTopZ],
      [G.plateHalfY, G.plateBottomZ],
    ]);
    const plateGeo = alignX(extrude(plate, G.plateThkCm, { bevel: 0, curveSegments: 1 }));
    plateGeo.translate((G.foreFaceX + G.plateForeX) / 2, 0, 0);
    put('cam-retainer', plateGeo, materials.fastenerSteel);

    // two bolts, one each side of the loaded cradle, standing along the cam axis
    // in the skirt's own wall band: their centres sit at the published bolt-chain
    // radius outside the line bore, at the depression that puts them in the iron
    // the end wall casts, and their heads bear on the plate.
    for (const sgn of [1, -1]) {
      const yc = sgn * G.boltLocalY;
      const zc = -H.belowCrankCm - G.boltDropCm;
      put(`cam-retainer-bolt-${sgn > 0 ? '+' : '-'}`, worldBox(
        G.foreFaceX - G.boltEngageCm, G.plateForeX + G.boltHeadCm,
        yc - G.boltCircumR, yc + G.boltCircumR,
        zc - G.boltCircumR, zc + G.boltCircumR, 0.15), materials.fastenerDark);
    }

    // A1-G6 / issue #16 option B (slice 8C-3a): the lifter gallery this variant
    // casts for its 16 lifters - four cluster ribs per bank, each carrying the
    // two bores of one cylinder, bored through the rib's own iron. Each rib is
    // the mouth block plus the guide wall the crank-side room leaves room for.
    const GAL = ohvLifterGallery();
    for (const bank of ['L', 'R']) {
      GAL.banks[bank].clusters.forEach(([x0, x1], i) => {
        const parts = [
          ohvGalleryRib(GAL, bank, [x0, x1], [GAL.banks[bank].guideFrom, GAL.banks[bank].stepT], GAL.banks[bank].ribIn, `gallery-${bank}-${i + 1}`),
          ohvGalleryRib(GAL, bank, [x0, x1], [GAL.banks[bank].stepT, GAL.banks[bank].guideTo], GAL.banks[bank].wallIn, `gallery-${bank}-${i + 1}-guide`),
        ];
        for (const p of parts) {
          const rib = put(p.name, p.geo, materials.castIronBlock);
          rib.userData.bores = p.bored.map((b) => b.name);
        }
      });
    }
  }

  // 3. outboard deck support columns (bottom corners on the OD chord plane)
  //    + inboard bridge webs (inner corners tangent to the void wall),
  //    one pair per bank per station slab
  const aWeb = idHalfDepth(B.boreWallHalf);
  for (const bank of ['L', 'R']) {
    const col = supportColumn(bank);
    for (const s of B.stations) {
      put(
        `column-${bank}-${s}`,
        boxInBank(bank, col.along0, B.deckA, B.boreWallHalf, B.deckHalfWidth, s - 5.5, s + 5.5, 0.35),
        materials.castIronBlock
      );
      put(
        `web-${bank}-${s}`,
        boxInBank(bank, aWeb, B.deckA, -B.deckHalfWidth, -B.boreWallHalf, s - 5.5, s + 5.5, 0.35),
        materials.castIronBlock
      );
    }
  }

  // 4. bore liners: OD presses into the wall columns, top flush with the deck
  const liner = [
    [LINER_OD, B.boreStartA],
    [LINER_OD, B.deckA],
    [B.boreRadius, B.deckA],
    [B.boreRadius, B.boreStartA],
    [LINER_OD, B.boreStartA],
  ];
  for (const cyl of SPEC.cylinders) {
    put(`liner-cyl${cyl.num}`, latheBank(cyl.bank, liner, 48, B.stations[cyl.station]), materials.boreWall);
  }

  // 5. main bearing hardware.
  //    Interior mains (x 11, 0, -11): two cap lugs hugging the void wall plus a
  //    neck tower rising to the bearing shell, all outside the counterweight
  //    sweep (neck top stays at r >= SHELL_OUT, lugs stay at r > counterRadius).
  //    OHV (A1-G7 / issue #16): the bored cam tunnel takes the drum's whole lower
  //    wall band out of this casting at |y| <= the bored radius, so the central
  //    neck tower of the DOHC build cannot stand here. The same main bearing is
  //    carried the way an OHV small-block carries it: a cap straddling the cast
  //    crown of the tunnel - the published wall outside the bore - and tied down
  //    on the housing walls the tunnel was bored through, with its bolts in the
  //    wrench-clearance band outside them. Every plane below is a published wall.
  const lug = mainCapLug();
  const BEAR = SPEC.cam.bearing;
  const shellTopZ = -SPEC.block.mainSeat.castTopCm; // the cast top plane the seat bore is machined through
  const crownZ = H ? -(H.belowCrankCm - H.tunnelWallR) : null; // top of the cast tunnel wall
  const band = (sgn, a, b) => (sgn > 0 ? [a, b] : [-b, -a]); // the same wall on either side
  for (const c of MAIN_CAPS_X) {
    const x0 = c - 0.9;
    const x1 = c + 0.9;
    const name = `main-shell-x${c}`;
    const feed = OILNET.feeds.find((f) => f.part === name);
    // A1-G4 / issue #8 item 5 (slice 8D-2b): the shell is machined with its own
    // drilled oil way, bored radially at the azimuth its published feed arrives
    // from. A main this variant does not feed - the OHV fore and aft mains, named
    // pending on issue #28 - stays a plain turned ring: drilling a bearing the
    // published network does not feed would draw a way to nowhere.
    const shell = feed
      ? drilledRingX(SHELL_IN, SHELL_OUT, x0 + 0.05, x1 - 0.05, feed.az, SPEC.oil.feedDrillR, 40)
      : latheX(ringX(SHELL_OUT, SHELL_IN, x0 + 0.05, x1 - 0.05), 40);
    const sh = put(name, shell, materials.bearingShell);
    if (feed) sh.userData.oilAz = [feed.az];
    if (c === MAIN_CAPS_X[0] || c === MAIN_CAPS_X[4]) continue; // fore/aft mains ride the end discs
    if (H) {
      for (const sgn of [1, -1]) {
        // boot legs standing on the housing wall beside the bored tunnel, from
        // the skirt's tie-in on the OD circle up to the bearing shell flank. Named
        // for its side like the cap bar and cap bolt it carries: two drawn solids
        // cannot share one name, because PART INSPECTION and the explode chain
        // address a member by name (issue #16 slice 8C-3e).
        const [ly0, ly1] = band(sgn, H.skirtInboardY, H.skirtHalfY);
        put(`main-neck-x${c}${sgn > 0 ? '+' : '-'}`, worldBox(c - 0.8, c + 0.8, ly0, ly1, H.skirtCornerZ, shellTopZ, 0.2), materials.castIronBlock);
        // the cap bar: bottom face on the cast crown of the bored tunnel, top face
        // bored at the published seat radius so it carries the shell on a machined
        // arc - it reaches the full lug width
        const [cy0, cy1] = band(sgn, 0, lug.y1);
        put(`main-cap-${c}${sgn > 0 ? '+' : '-'}`, mainSupport(c - 2.3, c + 2.3, cy0, cy1, crownZ, SPEC.block.mainSeat.castTopCm), materials.castIronBlock);
        // cap bolt standing in the wrench-clearance band outside that boot wall,
        // same fastener family and proportions as the DOHC main bolts it replaces
        const [by0, by1] = band(sgn, H.skirtHalfY - 0.1, H.skirtHalfY + 0.75);
        put(`main-bolt-${c}${sgn > 0 ? '+' : '-'}`, worldBox(c - 0.55, c + 0.55, by0, by1, crownZ - 0.55, crownZ + 0.1, 0.15), materials.fastenerDark);
      }
      continue;
    }
    // neck stays inside the web gap (|x-c| <= 0.8 < 0.95) and is bored at the
    // published seat radius: its top is the machined seat arc, not a plane crossing
    // the shell bore (issue #18 ask 3)
    put(`main-neck-x${c}`, mainSupport(c - 0.8, c + 0.8, -3.1, 3.1, lug.zBottom, SPEC.block.mainSeat.castTopCm), materials.castIronBlock);
    put(`main-cap-${c}+`, worldBox(c - 2.3, c + 2.3, lug.y0, lug.y1, lug.zBottom, lug.zTop, 0.25), materials.castIronBlock);
    put(`main-cap-${c}-`, worldBox(c - 2.3, c + 2.3, -lug.y1, -lug.y0, lug.zBottom, lug.zTop, 0.25), materials.castIronBlock);
    put(`main-bolt-${c}+`, worldBox(c - 0.55, c + 0.55, lug.y1 - 0.1, lug.y1 + 0.75, lug.zBottom - 0.55, lug.zBottom + 0.1, 0.15), materials.fastenerDark);
    put(`main-bolt-${c}-`, worldBox(c - 0.55, c + 0.55, -lug.y1 - 0.75, -lug.y1 + 0.1, lug.zBottom - 0.55, lug.zBottom + 0.1, 0.15), materials.fastenerDark);
  }

  // 6. pan rails: flat bolt pads cast across the bottom face of THIS variant's
  //    casting, then the sump hanging B below the plane it is cast on, plus its
  //    drain plug. The DOHC build casts them on the drum's chord at the published
  //    planes over the station slabs; the OHV build casts them on its skirt bottom,
  //    which runs the whole length of the casting, so its pad and sump do too.
  const wRail = P.flangeHalfY;
  const railX = H ? endDiscFaceX() : X_FRONT;
  put('pan-rails', worldBox(-railX, railX, -wRail, wRail, P.railZ, P.flangeZ, 0.1), materials.castIronBlock);
  put('oil-pan', worldBox(-railX + 1, railX - 1, -P.wallHalfY, P.wallHalfY, P.panBottomZ, P.railZ, 0.6), materials.paintedGraphite);
  put('pan-plug', worldBox(-18.5, -17.5, -0.5, 0.5, P.panBottomZ - B.oilPanPlugDropCm, P.panBottomZ + PLUG_IN, 0.2), materials.brass);

  group.userData.family = 'block';
  return group;
}
