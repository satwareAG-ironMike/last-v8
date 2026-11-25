// The cooling of both builds - issue #8 addendum item 1, GATES row A1-G6 slice 8E:
// the NETWORK of water passages the block and heads are bored in.
//
// One jacket band per bank side, one deck riser per band per cylinder and per bank
// end, a link at each end carrying that riser's water outboard, and one cross gallery
// in each head end wall bridging the valley side and the two outboard flanks. Every
// passage here is a chain of legs, one leg per casting it is bored in, each leg a
// window in its bank's own frame (x across the engine, a up the bore axis, o outboard)
// derived from SPEC.coolant. src/render/coolant.js draws exactly these windows.
//
// Nothing in this file reads the render tree. The iron these legs are bored in and the
// iron standing behind every wall claim below is measured by
// test/support/coolant-iron.mjs through the committed oracle, and the claims were set
// from tmp/8e-claims.mjs, which walks out of each face in 0.02 cm steps until the
// drawn casting stops being iron:
//   jacket floor 4.66 (5.18 out-out), crown >=6.00, inner 0.42, outer 0.36, ends 0.32
//   block riser inner 0.42, outer 0.36, ends 0.32
//   head port inner 0.36, outer 0.36 (1.32 at the ends), crown 4.62
//   head link outer 1.32, crown >=6.00        cross gallery floor 0.36, sides 1.32,
//   ends 1.56..3.02
// Each claim published below is the published wall (SPEC.coolant.landCm and friends),
// and every one of them is thinner than the walk that measured it.
//
// What is NOT here, stated rather than hidden (SPEC.coolant.pending):
//   nothing moves this water - no pump, no thermostat, no radiator or hose route,
//   no drain, and SPEC models no pump drive or temperature;
//   the jackets are cavities in the drawn castings, not machined holes: no coolant
//   bore is drawn as a drilling the way the oil ways are.
import { SPEC } from './spec.js';

const B = SPEC.block;
const H = SPEC.head;
const C = SPEC.coolant;

const ENDS = [[1, 'fore'], [-1, 'aft']];

/** The window of one jacket band: the wall band this bank carries water in. */
const jacketLeg = (band) => ({
  a0: C.jacketFloorA, a1: C.jacketCrownA, o0: band.o0, o1: band.o1,
  x0: -C.jacketXHalfCm, x1: C.jacketXHalfCm,
});

/** The walls a jacket is closed by, each thinner than the iron measured behind it. */
const jacketWalls = () => ({
  floor: C.floorWallCm, // 4.0 of iron down to the crankcase drum (measured 4.66)
  crown: C.deckBandCm, // 2.6 of iron up to the machined deck face
  inner: C.landCm, // 0.4 of cast land between the water and the press-fit liner
  outer: C.skinCm, // 0.35 of casting skin between the water and the block's outer face
  x0: C.bayClrCm, // 0.3 of cast end wall before the counter bay mouth opens
  x1: C.bayClrCm,
});

/**
 * @param variantId 'dohc' or 'ohv' - the block half differs by casting, the head half
 *   is the same head both builds bolt on
 */
export function coolantNetwork(variantId = SPEC.build.variant) {
  if (variantId !== 'dohc' && variantId !== 'ohv') {
    throw new Error(`coolantNetwork: no variant ${variantId}`);
  }
  const jackets = [];
  const ports = [];
  const links = [];
  const galleries = [];

  for (const bank of ['L', 'R']) {
    for (const band of C.bands) {
      jackets.push({
        id: `coolant-jacket-${bank}-${band.id}`,
        kind: 'jacket',
        member: `coolant-jacket-${bank}-${band.id}`,
        bank,
        band: band.id,
        cast: 'block',
        leg: jacketLeg(band),
        walls: jacketWalls(),
      });

      // one deck riser per band per cylinder: the water leaves the jacket crown up
      // through the deck face into the head, and it is the same window in both
      // castings - the passage continues, it does not restart at the gasket
      B.stations.forEach((station, i) => {
        const id = `coolant-port-${bank}-${band.id}-s${i}`;
        ports.push({
          id,
          kind: 'riser',
          bank,
          band: band.id,
          station,
          legs: [
            {
              cast: 'block',
              member: `${id}-block`,
              leg: { a0: C.jacketCrownA, a1: C.deckA, o0: band.o0, o1: band.o1, x0: station - C.portHalfXcm, x1: station + C.portHalfXcm },
              walls: { inner: C.landCm, outer: C.skinCm, x0: C.bayClrCm, x1: C.bayClrCm },
            },
            {
              cast: 'head',
              member: `${id}-head`,
              leg: { a0: C.headFloorA, a1: C.headCrownA, o0: band.o0, o1: band.o1, x0: station - C.portHalfXcm, x1: station + C.portHalfXcm },
              walls: { inner: C.skinCm, outer: C.skinCm, crown: C.wallMinCm, x0: C.bayClrCm, x1: C.bayClrCm },
            },
          ],
        });
      });

      // and one at each end of the bank, outboard of the last cylinder, which is
      // where the head's end wall takes the water across
      for (const [sgn, side] of ENDS) {
        const id = `coolant-port-${bank}-${band.id}-end${side}`;
        const x0 = sgn > 0 ? C.jacketXHalfCm - C.endPortWidthCm : -C.jacketXHalfCm;
        const x1 = sgn > 0 ? C.jacketXHalfCm : -C.jacketXHalfCm + C.endPortWidthCm;
        ports.push({
          id,
          kind: 'riser',
          bank,
          band: band.id,
          side,
          legs: [
            {
              cast: 'block',
              member: `${id}-block`,
              leg: { a0: C.jacketCrownA, a1: C.deckA, o0: band.o0, o1: band.o1, x0, x1 },
              walls: { inner: C.landCm, outer: C.skinCm, x0: C.bayClrCm, x1: C.bayClrCm },
            },
            {
              cast: 'head',
              member: `${id}-head`,
              leg: { a0: C.headFloorA, a1: C.headCrownA, o0: band.o0, o1: band.o1, x0, x1 },
              walls: { inner: C.skinCm, outer: C.skinCm, crown: C.wallMinCm },
            },
          ],
        });

        // the link from that end riser out to the cross gallery. Its two x faces are
        // joints into the riser and into the gallery, so it claims walls on the three
        // faces that stand in iron
        links.push({
          id: `coolant-headlink-${bank}-${band.id}-${side}`,
          kind: 'link',
          member: `coolant-headlink-${bank}-${band.id}-${side}`,
          bank,
          band: band.id,
          side,
          cast: 'head',
          leg: {
            a0: C.headFloorA, a1: C.headCrownA, o0: band.o0, o1: band.o1,
            x0: sgn > 0 ? x1 : -(C.crossX0Cm + C.linkIntoGalleryCm),
            x1: sgn > 0 ? C.crossX0Cm + C.linkIntoGalleryCm : x0,
          },
          walls: { inner: C.skinCm, outer: C.skinCm, crown: C.wallMinCm },
        });
      }
    }

    // one cross gallery per bank end, bored through the head's fore/aft end wall:
    // it straddles the bore line, so the valley side and both outboard flanks share
    // one passage. Its floor stands 0.35 cm above the head deck face because out
    // over the block's end there is no deck to close it from below
    for (const [sgn, side] of ENDS) {
      galleries.push({
        id: `coolant-headgallery-${bank}-${side}`,
        kind: 'gallery',
        member: `coolant-headgallery-${bank}-${side}`,
        bank,
        side,
        cast: 'head',
        leg: {
          a0: C.crossFloorA, a1: C.headCrownA, o0: -C.waterOutCm, o1: C.waterOutCm,
          x0: sgn > 0 ? C.crossX0Cm : -C.crossX1Cm, x1: sgn > 0 ? C.crossX1Cm : -C.crossX0Cm,
        },
        walls: {
          floor: C.crossFloorClrCm, inner: C.skinCm, outer: C.skinCm,
          crown: C.wallMinCm, x0: C.bayClrCm, x1: C.bayClrCm,
        },
      });
    }
  }

  const members = [
    ...jackets.map((j) => j.member),
    ...ports.flatMap((p) => p.legs.map((L) => L.member)),
    ...links.map((l) => l.member),
    ...galleries.map((g) => g.member),
  ];
  const legs = jackets.length + ports.reduce((n, p) => n + p.legs.length, 0) + links.length + galleries.length;

  return {
    variant: variantId,
    spec: C,
    jackets,
    ports,
    links,
    galleries,
    members,
    counts: {
      jackets: jackets.length,
      risers: ports.length,
      links: links.length,
      galleries: galleries.length,
      legs,
      members: members.length,
      bands: C.bands.length,
      banks: 2,
    },
    pending: C.pending,
  };
}

/**
 * Which published passage hands its water to which: the chain a coolant particle
 * travels, published so a law or a label can name it instead of implying it.
 */
export function coolantRoute(variantId = SPEC.build.variant, member = null) {
  const net = coolantNetwork(variantId);
  const byMember = new Map();
  for (const j of net.jackets) byMember.set(j.member, [j]);
  for (const p of net.ports) {
    const jacket = net.jackets.find((j) => j.bank === p.bank && j.band === p.band);
    byMember.set(p.legs[0].member, [jacket, p]);
    byMember.set(p.legs[1].member, [jacket, p]);
  }
  for (const l of net.links) {
    const jacket = net.jackets.find((j) => j.bank === l.bank && j.band === l.band);
    const riser = net.ports.find((p) => p.bank === l.bank && p.band === l.band && p.side === l.side);
    const gallery = net.galleries.find((g) => g.bank === l.bank && g.side === l.side);
    byMember.set(l.member, [jacket, riser, l, gallery]);
  }
  for (const g of net.galleries) {
    const gallery = [g];
    const own = net.links.filter((l) => l.bank === g.bank && l.side === g.side);
    byMember.set(g.member, [g, ...own]);
  }
  const chain = byMember.get(member);
  if (!chain) throw new Error(`no coolant route for "${member}" in the ${net.variant} network`);
  return chain.filter(Boolean);
}
