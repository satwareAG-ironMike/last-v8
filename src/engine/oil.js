// The procedural oil system - issue #8 addendum item 5, slice 8D-1: the NETWORK.
//
// One pump in each variant's own sump, its pickup screen in the pan, its discharge
// way bored into a main gallery, and from that gallery a feed drilling to every main
// bearing, through the crank to every rod bearing, up the block flank into the head
// deck rail and on to every cam bearing. Every route here is a published bore: a
// centrelines polyline plus the radius it is drilled at, derived from SPEC.oil, and
// test/oil.test.mjs law 7 samples each one against the drawn iron allowing ONLY the
// parts and oil spaces the route itself names. Nothing in this file reads the render
// tree; the oracle lives in test/support/oil-iron.mjs so the proof stays independent
// of what it proves.
//
// What is NOT here yet, and each clause is named rather than hidden:
//   SPEC.oil.pending.drawnHoles (#8)  - the drilled oil holes in the iron: 8D-2b
//     machined them into the 5 main shells and the 5 OHV tunnel bushings
//     (src/render/block.js, gated in test/block.test.mjs); the gasket oil hole and
//     the rod's internal bore are the two clauses that file names as still open.
//   SPEC.oil.pending.lifterGallery (#16) - the OHV lifter gallery: no lifter bank is
//     cast until 8C-3 chooses its option, so there is nothing to feed.
//   SPEC.oil.pending.ohvMains / ohvInboardGallery (#28) - the OHV fore and aft mains
//     and the inboard crown gallery: the drawn carriers stand 4.70 cm off the wall
//     band and no part of the current casting bridges the banks at the crown plane.
import {
  BANKS,
  MAIN_CAPS_X,
  SPEC,
  bankOut,
  bankUp,
  camAxisBank,
  endDiscFaceX,
} from './spec.js';
import { bearingStack } from './bearings.js';
import { camGroupNames, ohvBearings, ohvHousing, panPlanes } from './layout.js';

const B = SPEC.block;
const HEAD = SPEC.head;
const CR = SPEC.crank;
const CAM = SPEC.cam;
const OIL = SPEC.oil;
const ST = bearingStack();
const DEG = Math.PI / 180;

const MID_R = OIL.galleryMidR; // 10.5 the crankcase wall band mid radius
const GAL_R = OIL.galleryR; // 0.5 the gallery bored in it
const FEED_R = OIL.feedDrillR; // 0.1 the published shell oil way
const PUMP_R = OIL.pumpDrillR; // 0.3 the pump discharge way
const RAIL_OUT = OIL.railOut; // 6.25 mid of the drawn deck rail
const RAIL_BAND = OIL.railBand; // 25.625 mid of the band the head machines at railTopA
const X_GAL = endDiscFaceX() - OIL.galleryFaceClrCm; // 26.0 gallery extent
const SHELL_OUT = CR.mainRadius + OIL.mainShell.filmCm + OIL.mainShell.wallCm; // 3.45
const CAM_R = ST.boreR; // 2.05 the cam line bore the feed ends on

/** A point in one bank's own frame: x across the engine, along up the bore axis, out outboard. */
const bp = (bank, x, along, out) => {
  const u = bankUp(bank);
  const v = bankOut(bank);
  return [x, along * u[1] + out * v[1], along * u[2] + out * v[2]];
};
/** A point about one cam line: r off its axis, psi 0 crown-ward (SPEC.cam.bearing.oilAz). */
const cp = (bank, valve, x, r, psiDeg) => {
  const [A, O] = camAxisBank(bank, valve);
  const p = psiDeg * DEG;
  return bp(bank, x, A + r * Math.cos(p), O + r * Math.sin(p));
};

const variantEntry = (id) => {
  const v = SPEC.variants[id];
  if (!v) throw new Error(`no oil system for variant "${id}": SPEC.variants publishes ${Object.keys(SPEC.variants).join(', ')}`);
  return v;
};

/** What one variant's oil system publishes: walls, radii, sump planes and counts. */
export function oilSpec(id = SPEC.build.variant) {
  const v = variantEntry(id);
  const P = panPlanes(v.id);
  return {
    variant: v.id,
    galleryMidR: MID_R,
    galleryR: GAL_R,
    wallMinCm: OIL.wallMinCm,
    gallerySpanX: X_GAL,
    feedDrillR: FEED_R,
    pumpDrillR: PUMP_R,
    railOut: RAIL_OUT,
    railBand: RAIL_BAND,
    railTopCm: OIL.railTopCm,
    sump: {
      railZ: P.railZ,
      flangeZ: P.flangeZ,
      panBottomZ: P.panBottomZ,
      wallHalfY: P.wallHalfY,
    },
    counts: OIL.counts[v.id],
    pendingIssues: OIL.pendingIssues,
    pending: OIL.pending,
  };
}

/** The pump, its pickup and the gauge that reads the gallery it fills. */
function sumpTrain(id) {
  const P = panPlanes(id);
  const stand = OIL.pump.stand[id];
  const body = [OIL.pump.x, stand.y, stand.z];
  const sgn = Math.sign(stand.y);
  const pump = {
    id: 'oil-pump',
    kind: 'pump',
    part: 'oil-pump',
    body,
    r: OIL.pump.r,
    outlet: [OIL.pump.x, stand.y - sgn * OIL.pump.r, stand.z], // discharges inboard
    inlet: [OIL.pump.x, stand.y + sgn * OIL.pump.r, stand.z], // drinks from the pickup
    drillR: PUMP_R,
  };
  const pickup = {
    id: 'oil-pan-pickup',
    kind: 'pickup',
    part: 'oil-pan-pickup',
    screen: [OIL.pickupX, 0, P.panBottomZ + OIL.pickupDropCm], // hanging in the sump
    stem: pump.inlet, // out through the pan wall and up the flank to the pump inlet
  };
  return { pump, pickup };
}

/** The wall-band arc from the gallery to the height a flank column starts at. */
function flankLeg(bank, station, floorAlong, out) {
  const base = bp(bank, station, floorAlong, out);
  const a1 = ((Math.atan2(base[1], base[2]) * 180) / Math.PI + 360) % 360;
  const path = [[station, 0, -MID_R]];
  let dd = a1 - 180;
  while (dd > 180) dd -= 360;
  while (dd < -180) dd += 360;
  for (let a = 180 + Math.sign(dd) * 3;
    Math.sign(a1 - a) === Math.sign(dd) && Math.abs(a1 - a) > 1e-9;
    a += Math.sign(dd) * 3) {
    const t = a * DEG;
    path.push([station, MID_R * Math.sin(t), MID_R * Math.cos(t)]);
  }
  path.push(
    base,
    bp(bank, station, B.deckA - OIL.deckFaceClrCm, out),
    bp(bank, station, B.deckA + OIL.deckRiseCm, out),
    bp(bank, station, RAIL_BAND, out),
  );
  return path;
}

/** The DOHC head rail galleries: one per camshaft, each on the flank its cam stands on. */
function camRails(id) {
  const rails = [];
  for (const group of camGroupNames(id)) {
    const [, bank, valve] = group.split('-');
    const [, O] = camAxisBank(bank, valve);
    const sgn = Math.sign(O);
    const out = sgn * RAIL_OUT;
    rails.push({
      id: `oil-gallery-cam-${bank}-${valve}`,
      kind: 'gallery',
      group,
      bank,
      valve,
      outboard: sgn === 1,
      part: `rail-${bank}-${sgn === 1 ? 'out' : 'in'}`,
      along: RAIL_BAND,
      out,
      x0: CAM.bearings[0],
      x1: CAM.bearings[CAM.bearings.length - 1],
      r: FEED_R,
      drillR: FEED_R,
      path: [bp(bank, CAM.bearings[0], RAIL_BAND, out), bp(bank, CAM.bearings.at(-1), RAIL_BAND, out)],
      allow: {},
      // the outboard rail is filled by the block's own flank legs, the inboard one
      // only through the head's chimney iron: no wall-band arc reaches it without
      // plowing a press-fit liner (tmp/8d-linkdir.out, tmp/8d-whered.mjs)
      from: sgn === 1 ? `oil-link-${bank}-out-x${B.stations[0]}` : `oil-bridge-${bank}-fore`,
    });
  }
  return rails;
}

/** The DOHC head crossings that fill the two inboard rails, fore and aft. */
function camBridges(rails) {
  const out = [];
  for (const fed of rails.filter((r) => !r.outboard)) {
    const src = rails.find((r) => r.bank === fed.bank && r.outboard);
    for (const x of OIL.bridgeStationsX) {
      out.push({
        id: `oil-bridge-${fed.bank}-${x > 0 ? 'fore' : 'aft'}`,
        kind: 'bridge',
        bank: fed.bank,
        valve: fed.valve,
        gallery: fed.id,
        from: src.id,
        along: OIL.railTopCm, // bored at the machined rail plane, where the iron is
        x,
        part: fed.part,
        drillR: FEED_R,
        path: [bp(fed.bank, x, OIL.railTopCm, RAIL_OUT), bp(fed.bank, x, OIL.railTopCm, -RAIL_OUT)],
        allow: {},
      });
    }
  }
  return out;
}

/** Every main bearing feed: out of the gallery onto the shell its cap presses. */
const arriveAz = (path, axisY, axisZ) => {
  const last = path.at(-1);
  return (Math.atan2(last[2] - axisZ, last[1] - axisY) / DEG + 360) % 360;
};

function mainFeeds(id, gallery) {
  const feeds = [];
  const legs = id === 'dohc' ? null : OIL.ohvMainLeg;
  for (const x of id === 'dohc' ? MAIN_CAPS_X : OIL.ohvMainStationsX) {
    const path = legs
      ? legs.map(([y, z]) => [x, y, z]) // the corridor its cast boot legs leave free
      : [[x, 0, -MID_R], [x, 0, -SHELL_OUT]];
    feeds.push({
      id: `oil-main-x${x}`,
      kind: 'main',
      x,
      gallery: gallery.id,
      part: `main-shell-x${x}`,
      drillR: FEED_R,
      az: arriveAz(path, 0, 0), // the azimuth this shell has to be drilled at
      path,
      allow: { solid: [`main-shell-x${x}`], oil: [`film-main-x${x}`] },
    });
  }
  return feeds;
}

/** Every rod bearing: bored through the crank, in the throw it feeds. */
function rodFeeds(mains) {
  const byStation = new Map(mains.map((f) => [f.x, f]));
  const feeds = [];
  for (const cyl of SPEC.cylinders) {
    const s = B.stations[cyl.station];
    const az = CR.pinAz[cyl.station] * DEG;
    const rr = CR.radius - CR.pinRadius - OIL.rodFilmMidCm; // mid the film over the pin
    const main = MAIN_CAPS_X.find((c) => Math.abs(c - s) <= B.pitch / 2 + 1e-9);
    feeds.push({
      id: `oil-rod-cyl${cyl.num}`,
      kind: 'rod',
      cyl: cyl.num,
      from: byStation.get(main).id,
      throughCrank: true,
      part: `pin-s${s}`,
      drillR: FEED_R,
      path: [[main, 0, 0], [s, rr * Math.sin(az), rr * Math.cos(az)]],
      allow: { rotating: true }, // bored in the crank's own metal, inside its throw
    });
  }
  return feeds;
}

/** The DOHC cam feeds: rail gallery, over the housing tie rib, down to the line bore. */
function dohcCamFeeds(rails) {
  const feeds = [];
  for (const rail of rails) {
    const { bank, valve } = rail;
    const [, O] = camAxisBank(bank, valve);
    const sgn = Math.sign(O);
    for (const x of CAM.bearings) {
      feeds.push({
        id: `oil-cam-${bank}-${valve}-${x}`,
        kind: 'cam',
        group: rail.group,
        x,
        gallery: rail.id,
        from: rail.id,
        part: `shell-${bank}-${valve}-${x}-cradle`,
        drillR: FEED_R,
        path: [
          bp(bank, x, RAIL_BAND, sgn * RAIL_OUT),
          bp(bank, x, OIL.camFeedCrossCm, sgn * RAIL_OUT),
          bp(bank, x, OIL.camFeedCrossCm, O + sgn * OIL.camFeedOutRunCm),
          cp(bank, valve, x, OIL.camFeedStandCm, OIL.camFeedPsiDeg),
          cp(bank, valve, x, CAM_R, OIL.camFeedPsiDeg),
        ],
        allow: {
          solid: [`shell-${bank}-${valve}-${x}-cradle`],
          oil: [
            `oil-sump-cam-${bank}-${valve}-${x}`,
            `oil-corner-cam-${bank}-${valve}-${x}`,
            `film-cam-${bank}-${valve}-${x}`,
          ],
        },
      });
    }
  }
  return feeds;
}

/** The OHV cam feeds: crown gallery, in over the drum, down the tunnel wall, due
 * outboard into the bushing bore - the one azimuth its cast wall stands at r 3.4..4.28. */
function ohvCamFeeds(gallery, H, G, galY, crownZ) {
  return G.stations.map((x, i) => {
    const name = `cam-bushing-${i + 1}`;
    const path = [
      [x, galY, crownZ],
      [x, OIL.ohvCamFeed.inCm, crownZ],
      [x, H.tunnelWallR, OIL.ohvCamFeed.shelfZ],
      [x, H.tunnelWallR, -H.belowCrankCm],
      [x, G.boreR, -H.belowCrankCm],
    ];
    return {
      id: `oil-cam-ohv-${x}`,
      kind: 'cam',
      x,
      gallery: gallery.id,
      from: gallery.id,
      part: name,
      drillR: FEED_R,
      az: arriveAz(path, 0, -H.belowCrankCm), // due outboard: the azimuth this shell is drilled at
      path,
      allow: { solid: [name], oil: [`film-ohv-cam-${i + 1}`] },
    };
  });
}

/** One variant's whole oil network, derived from SPEC.oil. */
export function oilNetwork(id = SPEC.build.variant) {
  const v = variantEntry(id);
  const { pump, pickup } = sumpTrain(v.id);
  const supply = {
    id: 'oil-supply-main',
    kind: 'supply',
    from: pump.id,
    gallery: 'gallery-pending',
    part: 'oil-supply-main',
    drillR: PUMP_R,
    path: null,
    allow: {},
  };

  let gallery;
  let pendingGalleries = [];
  let camGalleries = [];
  let links = [];
  let bridges = [];
  let camFeeds;
  let mains;
  let lifterGallery = null;

  if (v.id === 'dohc') {
    gallery = {
      id: 'oil-gallery-main',
      kind: 'gallery',
      part: 'oil-gallery-main',
      from: supply.id,
      y: 0,
      z: -MID_R, // straight down the valley side of the wall band
      r: GAL_R,
      x0: -X_GAL,
      x1: X_GAL,
      drillR: GAL_R,
      path: [[-X_GAL, 0, -MID_R], [X_GAL, 0, -MID_R]],
      allow: {},
    };
    camGalleries = camRails(v.id);
    links = camGalleries
      .filter((rail) => rail.outboard)
      .flatMap((rail) => B.stations.map((st) => ({
        id: `oil-link-${rail.bank}-out-x${st}`,
        kind: 'link',
        bank: rail.bank,
        gallery: rail.id,
        from: gallery.id,
        x: st,
        part: rail.part,
        drillR: FEED_R,
        path: flankLeg(rail.bank, st, OIL.linkFloorCm, rail.out),
        allow: { oil: [`oil-deck-passage-${rail.bank}-out`] },
      })));
    bridges = camBridges(camGalleries);
    mains = mainFeeds(v.id, gallery);
    camFeeds = dohcCamFeeds(camGalleries);
  } else {
    const H = ohvHousing();
    const G = ohvBearings();
    const crownZ = -(H.belowCrankCm - H.tunnelWallR); // its machined tunnel crown plane
    const galY = Math.sqrt(MID_R * MID_R - crownZ * crownZ); // on the wall band mid radius
    gallery = {
      id: 'oil-gallery-main-out',
      kind: 'gallery',
      part: 'oil-gallery-main-out',
      from: supply.id,
      y: galY, // outboard of its skirt flank, where its iron runs
      z: crownZ,
      r: GAL_R,
      x0: -X_GAL,
      x1: X_GAL,
      drillR: GAL_R,
      path: [[-X_GAL, galY, crownZ], [X_GAL, galY, crownZ]],
      allow: {},
    };
    // its twin stands on the same plane on the other side, and nothing in the
    // current casting bridges the banks to fill it - issue #28
    pendingGalleries = [{
      id: 'oil-gallery-main-in',
      kind: 'gallery',
      part: 'oil-gallery-main-in',
      y: -galY,
      z: crownZ,
      r: GAL_R,
      x0: -X_GAL,
      x1: X_GAL,
      issue: OIL.pending.ohvInboardGallery,
      why: 'no part of the OHV casting bridges the two banks at the tunnel crown plane (tmp/8d-ohvfore.out, tmp/8d-ohvcross3.out)',
    }];
    mains = mainFeeds(v.id, gallery);
    camFeeds = ohvCamFeeds(gallery, H, G, galY, crownZ);
    lifterGallery = {
      id: 'oil-gallery-lifter',
      kind: 'gallery',
      part: 'oil-gallery-lifter',
      pending: OIL.pending.lifterGallery,
      feed: null,
      why: 'the gallery and its 16 bores are cast and their followers are drawn (slice 8C-3a/8C-3b); what is missing is the drilling that feeds this gallery from the main gallery (row A1-G4)',
    };
  }

  // the discharge way: out of the pump's inboard face, straight onto its gallery axis
  supply.gallery = gallery.id;
  supply.path = [pump.outlet, [pump.outlet[0], gallery.y, gallery.z]];

  const gauge = {
    id: 'oil-pressure-gauge',
    kind: 'gauge',
    part: 'oil-pressure-gauge',
    reads: gallery.id,
    at: [gallery.x0 + 0.5, gallery.y, gallery.z], // taps the gallery it has to read
  };
  const feeds = mains.concat(rodFeeds(mains), camFeeds);
  const pendingMains = (v.id === 'ohv' ? MAIN_CAPS_X.filter((x) => !OIL.ohvMainStationsX.includes(x)) : [])
    .map((x) => ({
      x,
      part: `main-shell-x${x}`,
      issue: OIL.pending.ohvMains,
      why: 'its drawn carrier stands off the wall band and no iron corridor reaches it (tmp/8d-ohvmain.out)',
    }));

  return {
    variant: v.id,
    spec: oilSpec(v.id),
    pump,
    pickup,
    gauge,
    supply,
    galleries: [gallery],
    pendingGalleries,
    camGalleries,
    links,
    bridges,
    feeds,
    pendingMains,
    lifterGallery,
    counts: OIL.counts[v.id],
  };
}

/** Trace one bearing's feed back to the pump: the chain of bores oil travels along. */
export function provenance(id = SPEC.build.variant, ref = null) {
  const net = oilNetwork(id);
  const ways = [net.supply, ...net.galleries, ...net.camGalleries, ...net.links, ...net.bridges, ...net.feeds];
  const byId = new Map([net.pump, net.pickup, net.gauge, ...ways].map((w) => [w.id, w]));
  const key = new Map();
  for (const f of net.feeds) {
    key.set(f.id, f);
    if (f.kind === 'main') key.set(`main@${f.x}`, f);
    if (f.kind === 'rod') key.set(`rod@${f.cyl}`, f);
    if (f.kind === 'cam') key.set(f.group ? `cam@${f.group}@${f.x}` : `cam@${f.x}`, f);
  }
  const chain = [];
  let cur = key.get(ref) ?? byId.get(ref);
  if (!cur) throw new Error(`no oil route for "${ref}" in the ${net.variant} network`);
  while (cur) {
    chain.unshift(cur);
    if (chain.length > 64) throw new Error(`the oil route ${ref} does not close on the pump`);
    const src = cur.from ?? cur.gallery; // a feed drinks from a gallery, a gallery from a supply way
    cur = src ? byId.get(src) : null;
  }
  return chain;
}
