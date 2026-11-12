// Scene plumbing for the view controls: CUTAWAY, EXPLODED VIEW / ASSEMBLE,
// PART INSPECTION.
//
// The laws live in src/engine/view.js; this module measures the assembly the
// renderer really built and applies those laws to it. Two things it guarantees:
//
// - the members it moves are a DISJOINT set: the direct mesh/group children of
//   the engine root plus the direct children of the four assembly groups. No
//   moved member is an ancestor of another, so an offset can never be applied
//   twice through the tree.
// - EXPLODED -> ASSEMBLE is exactly reversible. Offsets are written into
//   throwaway wrapper Groups inserted between a member and its parent, so the
//   animation's own writes to a member's local position/quaternion are never
//   touched, and detaching restores the parent, the child order and every local
//   transform byte-for-byte.
import * as THREE from 'three';

import { SPEC } from '../engine/spec.js';
import { clampFocus } from './cameraRig.js';
import {
  bboxRadius,
  cutawaySpecs,
  explodeLift,
  explodeOffsets,
  explodeRuleFor,
  explodeSpecs,
  framingRange,
  mountClearLift,
  partLabel,
} from '../engine/view.js';
import { setClipping } from '../render/materials.js';

const clamp = THREE.MathUtils.clamp;

/**
 * The set of objects an explode rule may move (see the disjointness note above).
 * @returns {{members:Map<string,THREE.Object3D>, assemblies:THREE.Object3D[]}}
 */
export function buildMembers(engine) {
  const members = new Map();
  const assemblies = [];
  for (const c of engine.children) {
    if (c.isGroup) {
      assemblies.push(c);
      for (const g of c.children) {
        if (g.isMesh || g.isGroup) {
          if (members.has(g.name)) throw new Error(`duplicate member name "${g.name}" in the assembly`);
          members.set(g.name, g);
        }
      }
    } else if (c.isMesh) {
      if (members.has(c.name)) throw new Error(`duplicate member name "${c.name}" in the casting`);
      members.set(c.name, c);
    }
  }
  return { members, assemblies };
}

/**
 * True extent of an object along a direction, measured on its real triangles
 * (a world axis-aligned Box3 would inflate a diagonal direction by the box's own
 * diagonal, which is not what a build axis means). Instanced fasteners are
 * measured through their instance matrices, because the whole point of the
 * exploded view is that the bolts go where the bolts actually are.
 */
export function measureExtent(obj, dirArray) {
  const d = new THREE.Vector3(...dirArray);
  const tmp = new THREE.Vector3();
  const base = new THREE.Matrix4();
  let near = Infinity;
  let far = -Infinity;
  const scan = (mesh, mat) => {
    const pos = mesh.geometry?.attributes?.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      tmp.fromBufferAttribute(pos, i).applyMatrix4(mat);
      const s = tmp.dot(d);
      if (s < near) near = s;
      if (s > far) far = s;
    }
  };
  // updateWorldMatrix(true, true) pulls the ANCESTORS too. updateMatrixWorld(true)
  // only pushes down from this node, so a member sitting inside a freshly created
  // explode wrapper was measured with the wrapper's stale identity matrix - the
  // offsets simply vanished from the measurement.
  obj.updateWorldMatrix(true, true); // measureExtent: ancestors first, or the wrapper offset is invisible
  const walk = (o) => {
    if (o.isInstancedMesh) {
      const im = new THREE.Matrix4();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, im);
        base.copy(o.matrixWorld).multiply(im);
        scan(o, base);
      }
    } else if (o.isMesh) {
      scan(o, o.matrixWorld);
    }
    for (const c of o.children) walk(c);
  };
  walk(obj);
  if (!Number.isFinite(near) || !Number.isFinite(far)) {
    throw new Error(`measureExtent: "${obj.name}" has no triangles to measure`);
  }
  return { near, far };
}

/** Lowest world z of an object once it has been moved by `dir * dist`. */
function shiftedLowestZ(obj, dir, dist) {
  const box = new THREE.Box3().setFromObject(obj);
  return box.min.z + dir[2] * dist;
}

const worldBox = (obj) => {
  obj.updateWorldMatrix(true, true); // ancestors first: see the note in measureExtent
  return new THREE.Box3().setFromObject(obj);
};

/**
 * The stand hardware that actually grips the engine, measured instead of
 * declared: a stand mesh is mount hardware exactly when its own box touches the
 * assembled engine. Everything else on the stand keeps SPEC.stand.minAir of the
 * engine by construction (gate G4/G5), so this set is precisely the plates, the
 * clamp bolts and the locator jaws.
 *
 * @returns {Array<{name:string, min:number[], max:number[]}>}
 */
export function mountHardware(stand, engine) {
  if (!stand) return [];
  engine.updateMatrixWorld(true);
  const engineBoxes = [];
  for (const c of engine.children) engineBoxes.push(worldBox(c));
  const out = [];
  stand.updateMatrixWorld(true);
  stand.traverse((o) => {
    if (!o.isMesh) return;
    const b = worldBox(o);
    for (const e of engineBoxes) {
      if (b.intersectsBox(e)) {
        out.push({ name: o.name, min: b.min.toArray(), max: b.max.toArray() });
        return;
      }
    }
  });
  return out;
}

/**
 * @param {{engine:THREE.Group, materials:object, rig:object, camera:THREE.Camera,
 *   scene:THREE.Scene, stand?:THREE.Object3D, damping?:number}} ctx
 */
export function createViewControls(ctx) {
  const { engine, materials, rig, camera, scene } = ctx;
  const S = explodeSpecs();
  const damping = ctx.damping ?? SPEC.view.damping;

  const { members } = buildMembers(engine);

  // Pristine child lists, snapshotted NOW - before a single wrapper exists.
  // Recording the slots at attach time is wrong twice over: attaching the first
  // member of a parent shifts every later member's index by one (the first
  // fingerprint run showed the same 828 nodes in a PERMUTED traverse order - main
  // bushings landed behind the support columns they were built after), and a
  // hand-rolled splice leaves obj.parent pointing at the removed wrapper unless
  // the parent links are rebuilt as well.
  const pristine = new Map(); // parent -> copy of its children array
  for (const obj of members.values()) {
    if (!pristine.has(obj.parent)) pristine.set(obj.parent, obj.parent.children.slice());
  }

  // ---- measure the assembly once: extents along each member's own build axis --
  const extents = new Map();
  const rules = new Map();
  for (const [name, obj] of members) {
    const r = explodeRuleFor(name);
    if (!r) continue;
    rules.set(name, r);
    extents.set(name, measureExtent(obj, r.dir));
  }
  const derived = explodeOffsets(extents);
  const offsets = derived.offsets;

  // ---- the hoist the chain forces ---------------------------------------------
  // (1) nothing may sink through the test-cell floor plate, and
  // (2) nothing may come to rest inside the stand's own mount hardware: the down
  //     chain pulls the oil pan 30 cm off the block while the hoist carries the
  //     block up, and the two meet exactly at the flange the stand clamps - the
  //     first measurement of this put the pan straight through four mount plates
  //     and the clamp bolts. Both requirements are derived, in that order, and a
  //     raised hoist can expose the next member, so it iterates to a fixed point.
  let lift = 0;
  for (const [name, off] of offsets) {
    lift = Math.max(lift, explodeLift([{ name, minZ: shiftedLowestZ(members.get(name), off.dir, off.dist) }], S));
  }
  const liftFromFloor = lift;
  const mounts = mountHardware(ctx.stand, engine);
  const liftReasons = [];
  for (let round = 0; round < 12; round++) {
    let need = 0;
    let why = null;
    for (const [name, obj] of members) {
      const off = offsets.get(name);
      const shift = off ? [off.dir[0] * off.dist, off.dir[1] * off.dist, off.dir[2] * off.dist] : [0, 0, 0];
      const b = worldBox(obj); // measured at hoist 0: the hoist is a pure +Z term
      for (const m of mounts) {
        const r = mountClearLift({ min: b.min.toArray(), max: b.max.toArray() }, shift, m, lift);
        if (r === null) throw new Error(`explode: "${name}" cannot be lifted clear of the stand mount "${m.name}"`);
        if (r > need) {
          need = r;
          why = `${name} vs ${m.name}`;
        }
      }
    }
    if (!(need > lift + 1e-9)) break;
    lift = need;
    liftReasons.push({ why, lift: +need.toFixed(2) });
  }

  // ---- explode state, held in wrappers so the animation is untouched ---------
  const wrappers = new Map(); // name -> {group, parent, index}
  const engineHomeZ = engine.position.z;
  let fraction = 0;
  let goal = 0;

  const attach = (name) => {
    const obj = members.get(name);
    const parent = obj.parent; // the pristine parent: wrappers are attached once,
    // and detachAll rebuilds the child list from the snapshot
    const group = new THREE.Group();
    group.name = `explode:${name}`;
    parent.remove(obj);
    parent.add(group);
    group.add(obj);
    wrappers.set(name, { group, parent });
  };

  const apply = () => {
    for (const [name, off] of offsets) {
      const w = wrappers.get(name);
      if (!w) continue;
      w.group.position.set(off.dir[0] * off.dist * fraction, off.dir[1] * off.dist * fraction, off.dir[2] * off.dist * fraction);
    }
    engine.position.z = engineHomeZ + lift * fraction;
  };

  const detachAll = () => {
    for (const [, w] of wrappers) w.group.remove(w.group.children[0]);
    wrappers.clear();
    // rebuild each affected parent's child list from the snapshot: exact original
    // order, exact original members, and obj.parent re-pointed (three's add()
    // only ever pushes, so neither the order nor the link can be repaired by a
    // splice alone)
    for (const [parent, kids] of pristine) {
      parent.children = kids.slice();
      for (const k of kids) k.parent = parent;
      parent.updateMatrixWorld(true);
    }
  };

  // ---- cutaway: one plane, derived from the published home view --------------
  // main.js hands ONE material set to every render module, so an engine material
  // and a stand material are often the SAME object (measured: `fastenerSteel` and
  // `standSteel` are shared with the test stand). Setting clippingPlanes on those
  // would cut the stand in half as well, so the cutaway swaps each engine mesh
  // onto a private clone and restores the original afterwards. The clones are
  // DoubleSide: a sectioned casting whose near half has been removed otherwise
  // shows nothing at all from the camera side, because its remaining inner wall
  // is a backface - which is what makes a cutaway read as hollow instead of as
  // metal.
  let cutawayOn = false;
  let plane = null;
  const engineMeshes = []; // { mesh, originals, wasArray }
  const sectioned = new Map(); // material name -> private clone
  const collectEngineMeshes = () => {
    engine.traverse((o) => {
      if (!o.isMesh) return;
      const wasArray = Array.isArray(o.material);
      engineMeshes.push({ mesh: o, originals: wasArray ? o.material.slice() : [o.material] });
    });
  };
  const sectionClone = (m) => {
    const key = m.name ?? m.uuid;
    let c = sectioned.get(key);
    if (!c) {
      c = m.clone();
      c.name = `${key}:sectioned`;
      c.side = THREE.DoubleSide;
      sectioned.set(key, c);
    }
    return c;
  };

  const setCutaway = (on) => {
    cutawayOn = !!on;
    if (engineMeshes.length === 0) collectEngineMeshes();
    if (cutawayOn) {
      const c = cutawaySpecs({ lift: lift * fraction });
      plane = new THREE.Plane(new THREE.Vector3(...c.normal), c.constant);
      const swapped = {};
      for (const rec of engineMeshes) {
        const list = rec.originals.map((m) => (m ? sectionClone(m) : m));
        rec.mesh.material = list.length === 1 ? list[0] : list;
        for (const m of list) if (m) swapped[m.name] = m;
      }
      setClipping(swapped, [plane]);
    } else {
      const all = {};
      for (const m of sectioned.values()) all[m.name] = m;
      if (sectioned.size) setClipping(all, []);
      for (const rec of engineMeshes) rec.mesh.material = rec.originals.length === 1 ? rec.originals[0] : rec.originals.slice();
      plane = null;
    }
    return cutawayOn;
  };

  // ---- part inspection --------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const inspectables = new Map(); // name -> {name, label, meshes}
  for (const [name, obj] of members) {
    const label = partLabel(name);
    if (label === name && !/^(column|web)-/.test(name)) continue; // unlabelled internals are not on the menu
    let meshes = 0;
    obj.traverse((o) => {
      if (o.isMesh) meshes += 1;
    });
    inspectables.set(name, { name, label, meshes });
  }

  let inspected = null;
  let frameRange = null; // the range the last inspection commanded the rig to take
  let selection = null;
  const clearSelection = () => {
    if (selection) {
      scene.remove(selection);
      selection.geometry.dispose();
      selection.material.dispose();
      selection = null;
    }
  };

  /** Put the selection outline on a live member box. */
  const fitBox = (line, box) => {
    const size = box.getSize(new THREE.Vector3());
    line.scale.set(Math.max(size.x, 1e-3), Math.max(size.y, 1e-3), Math.max(size.z, 1e-3));
    line.position.copy(box.getCenter(new THREE.Vector3()));
  };

  /** The member an object belongs to: the nearest named ancestor. */
  const memberOf = (obj) => {
    let o = obj;
    while (o && o !== engine) {
      if (members.has(o.name)) return o.name;
      o = o.parent;
    }
    return null;
  };

  /**
   * The framing a member gets when it is inspected.
   *
   * Two radii, on purpose. `radius` is the member's own size (what the menu
   * shows). `frameRadius` is the sphere the frustum has to contain, measured
   * from the point the camera is ANCHORED on - and the anchor is clamped to the
   * published walk volume. When the chain has carried a member out beyond that
   * volume (the top of the valvetrain sits at z 95.6 cm while the focus ceiling
   * is 70), the anchor is no longer the member's centre, and a framing sized on
   * the centre puts the member clean off screen (measured: ndc.y 1.72). A frustum
   * contains a sphere centred on its own axis, so the honest radius is the
   * farthest corner of the member's box from the anchor. With the anchor on the
   * centre the two are identical, which is why the assembled engine is
   * unaffected.
   */
  const framingFor = (name) => {
    const box = worldBox(members.get(name));
    const fit = bboxRadius({ min: box.min.toArray(), max: box.max.toArray() });
    const centre = box.getCenter(new THREE.Vector3());
    const anchor = clampFocus(centre);
    let frameRadius = fit.radius;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) frameRadius = Math.max(frameRadius, Math.hypot(x - anchor.x, y - anchor.y, z - anchor.z));
      }
    }
    return { box, ...fit, centre: centre.toArray(), anchor: anchor.toArray(), frameRadius, range: framingRange(frameRadius) };
  };

  const focusPart = (name) => {
    const obj = members.get(name);
    if (!obj) return null;
    const fit = framingFor(name);
    rig.focusOn(fit.anchor, fit.range); // the anchor is inside the walk volume
    frameRange = fit.range; // published: what this inspection asked the rig for
    clearSelection();
    // A UNIT box, scaled to the part: the outline then follows the member through a
    // separation and a collapse (see update()). A box geometry baked at the size the
    // part had when it was selected stays where it was and ends up floating next to
    // the part it labels - which is exactly the "nothing floating apart" rule.
    selection = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ name: 'inspectOutline', color: 0xffb020, transparent: true, opacity: 0.9 })
    );
    selection.name = 'inspect-outline';
    fitBox(selection, fit.box);
    scene.add(selection);
    inspected = name;
    return {
      name,
      label: partLabel(name),
      explode: offsets.get(name) ?? null,
      centre: fit.centre, // where the part is
      anchor: fit.anchor, // where the camera is anchored (clamped to the walk volume)
      radius: +fit.radius.toFixed(2),
      frameRadius: +fit.frameRadius.toFixed(2),
      range: +fit.range.toFixed(2),
      meshes: inspectables.get(name)?.meshes ?? null,
    };
  };

  /**
   * Pick the part under a canvas position (client px). With a cutaway active a
   * hit on the half that has been cut away is REJECTED: the raycaster does not
   * know about clipping planes, so the invisible side would otherwise be
   * clickable.
   */
  const pickAt = (xPx, yPx, rect) => {
    const ndc = {
      x: ((xPx - rect.left) / rect.width) * 2 - 1,
      y: -((yPx - rect.top) / rect.height) * 2 + 1,
    };
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(engine, true);
    for (const h of hits) {
      if (cutawayOn && plane && plane.distanceToPoint(h.point) < 0) continue;
      const name = memberOf(h.object);
      if (name) return focusPart(name);
    }
    return null;
  };

  /** Where the whole assembly sits once the chain has fully separated it. */
  const explodedBounds = () => {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    const extend = (b) => {
      v.copy(b.max);
      box.expandByPoint(v);
      v.copy(b.min);
      box.expandByPoint(v);
    };
    // the reference casting is carried by the hoist too - leaving it at its
    // installed height is what made the first measurement of this box read a
    // member 1.6 cm through the floor that the derived lift had already cleared
    const home = worldBox(engine);
    home.translate(new THREE.Vector3(0, 0, lift));
    extend(home);
    for (const [name, off] of offsets) {
      const b = worldBox(members.get(name));
      b.translate(new THREE.Vector3(off.dir[0] * off.dist, off.dir[1] * off.dist, off.dir[2] * off.dist + lift));
      extend(b);
    }
    const fit = bboxRadius({ min: box.min.toArray(), max: box.max.toArray() });
    return { min: box.min.toArray(), max: box.max.toArray(), ...fit };
  };

  let savedPose = null;
  let savedCutaway = null;

  /**
   * EXPLODED VIEW closes the cutaway, and ASSEMBLE puts the cutaway back to
   * whatever the user had it at. Measured reason: with the section open, the cut
   * eats the exploded families - against the lifted chain the plane puts 34 of
   * the 36 bank-L members, both camshafts, both intake plenums and both header
   * sets wholly on the clipped side, i.e. invisible. The chain does not need the
   * cut: every level of a family is separated from the next by at least
   * `clearance` along its own build axis, so a fully exploded engine shows its
   * internals by construction, which is the whole point of the chain law.
   */
  const explode = () => {
    if (wrappers.size === 0) {
      for (const name of offsets.keys()) attach(name);
      apply();
    }
    if (!savedPose) {
      const st = rig.state();
      savedPose = { target: st.focus.toArray(), dist: st.dist };
      savedCutaway = cutawayOn;
      if (cutawayOn) setCutaway(false);
    }
    goal = 1;
    const bounds = explodedBounds();
    rig.focusOn(bounds.centre, framingRange(bounds.radius));
    return bounds;
  };

  const assemble = () => {
    goal = 0;
    if (savedPose) {
      rig.focusOn(savedPose.target, savedPose.dist);
      savedPose = null;
    }
    if (savedCutaway !== null) {
      setCutaway(savedCutaway);
      savedCutaway = null;
    }
    return true;
  };

  /** dt-scaled easing so the separation and the collapse are smooth, not a jump. */
  const update = (dt) => {
    const h = clamp(dt, 0, 0.05);
    const k = 1 - Math.exp(-damping * h);
    const moved = Math.abs(goal - fraction) > 1e-6;
    fraction += (goal - fraction) * k;
    if (moved || fraction > 1e-6) apply();
    if (fraction < 1e-6 && goal === 0) {
      fraction = 0;
      engine.position.z = engineHomeZ;
      if (wrappers.size) detachAll();
    }
    // the outline is glued to the member, not to the coordinates the member had when
    // it was selected: through a separation and a collapse it travels with the part
    if (selection && inspected) {
      const obj = members.get(inspected);
      if (obj) fitBox(selection, worldBox(obj));
    }
    if (cutawayOn && plane) plane.constant = -new THREE.Vector3(...plane.normal).dot(new THREE.Vector3(0, 0, lift * fraction));
    return fraction;
  };

  /** PART INSPECTION off: the selection outline goes away, the pose stays. */
  const clearInspect = () => {
    clearSelection();
    inspected = null;
    frameRange = null;
    return inspected;
  };

  return {
    // published data (read by the tests and the panel)
    members,
    offsets,
    lift,
    spec: S,
    inspectables: () => [...inspectables.values()].sort((a, b) => a.name.localeCompare(b.name)),
    // controls
    setCutaway,
    explode,
    assemble,
    focusPart,
    clearInspect,
    pickAt,
    update,
    explodedBounds,
    isCutaway: () => cutawayOn,
    state: () => ({
      cutaway: cutawayOn,
      cutawayPlane: plane ? { normal: plane.normal.toArray(), constant: plane.constant } : null,
      fraction,
      goal,
      lift,
      inspected,
      frameRange,
      moved: wrappers.size,
      engineZ: engine.position.z,
    }),
  };
}
