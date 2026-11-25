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
} from '../engine/spec.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ohvBearings, ohvHousing, panPlanes, variantEntry } from '../engine/layout.js';
import { oilNetwork } from '../engine/oil.js';
import { boxInBank, worldBox, latheX, latheBank, machinedArc, machinedCircle } from './parts.js';
import { alignX, circleHole, extrude } from './primitives.js';

const B = SPEC.block;
const CR = SPEC.crank;
const LINER_OD = B.boreShellRadius + B.linerWallCm; // slips into the bore wall columns
const X_FRONT = B.stations[0] + B.pitch / 2; // 22
const X_REAR = B.stations[3] - B.pitch / 2; // -22
const SHELL_IN = CR.mainRadius + 0.05; // bearing shell inner
const SHELL_OUT = SHELL_IN + 0.7;
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
  const shellTopZ = -SHELL_OUT + 0.1; // 0.1 into the shell ring, as the neck does
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
        // the skirt's tie-in on the OD circle up to the bearing shell flank
        const [ly0, ly1] = band(sgn, H.skirtInboardY, H.skirtHalfY);
        put(`main-neck-x${c}`, worldBox(c - 0.8, c + 0.8, ly0, ly1, H.skirtCornerZ, shellTopZ, 0.2), materials.castIronBlock);
        // the cap bar: bottom face on the cast crown of the bored tunnel, top
        // face press-fit into the shell ring - it reaches the full lug width
        const [cy0, cy1] = band(sgn, 0, lug.y1);
        put(`main-cap-${c}${sgn > 0 ? '+' : '-'}`, worldBox(c - 2.3, c + 2.3, cy0, cy1, crownZ, shellTopZ, 0.25), materials.castIronBlock);
        // cap bolt standing in the wrench-clearance band outside that boot wall,
        // same fastener family and proportions as the DOHC main bolts it replaces
        const [by0, by1] = band(sgn, H.skirtHalfY - 0.1, H.skirtHalfY + 0.75);
        put(`main-bolt-${c}${sgn > 0 ? '+' : '-'}`, worldBox(c - 0.55, c + 0.55, by0, by1, crownZ - 0.55, crownZ + 0.1, 0.15), materials.fastenerDark);
      }
      continue;
    }
    // neck stays inside the web gap (|x-c| <= 0.8 < 0.95) and never enters
    // the shell bore (top at r 3.35 > main radius 2.7) but overlaps the shell ring
    put(`main-neck-x${c}`, worldBox(c - 0.8, c + 0.8, -3.1, 3.1, lug.zBottom, shellTopZ, 0.2), materials.castIronBlock);
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
