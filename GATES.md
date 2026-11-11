# Gates: V8 test-stand simulation

OWNS: src/**, test/**, public/**

RECIPE (recorded 2026-11-11, heads unit): `gate-sig` = first 16 hex of
`sha256(CHECK + "\n" + EXPECT)`. G1-G3 carry sigs written by an earlier runner whose
construction was never recorded in this repo and cannot be reproduced from the ledger;
their recomputable evidence is `output-sha256`. Their EVIDENCE lines are left untouched
rather than rewritten after the fact.

- [x] G1: cross-plane firing order derives from geometry as 1-8-7-3-6-5-4-2, 90 deg apart
  CHECK: node --test test/*.test.mjs
  EXPECT: fail 0
  EVIDENCE: exit=0; EXPECT=matched; gate-sig=af27c64b39beac1f; output-sha256=45c5952073018e3b7a8791218ee2134e275b3647652ad8eaa6208a9e4d9c62bd

- [x] G2: piston/rod/crank kinematics conserve rod length at every crank angle
  CHECK: node --test test/*.test.mjs
  EXPECT: fail 0
  EVIDENCE: exit=0; EXPECT=matched; gate-sig=af27c64b39beac1f; output-sha256=83076a3061ebc6841217b05aa31254f09ba9acc2d3c24c03fb81f3748355c14a

- [x] G3: camshafts turn at exactly half crank speed and valve lift comes from the cam lobe profile
  CHECK: node --test test/*.test.mjs
  EXPECT: fail 0
  EVIDENCE: exit=0; EXPECT=matched; gate-sig=af27c64b39beac1f; output-sha256=83374c4aeb961ca7d9d15ef931ff0637f075c5de34e8f14ea58fb5765737a7f5
  NOTE (valvetrain unit): rendered cams rotate +theta/2 rad; 16 lobes cut from lobeProfileRadius; nose faces its follower exactly at crankEvent(cyl, eventMid). Mutation controls (10): cam sign flip, cam ratio 1.5x, lobe bevel 0.9, shim offset +0.05, bucket ignores lift, spring seat follows valve, retainer off the tip, dropped cam bearing, sprocket band +0.2, valve ignores lift - each broke 1-2 of 41 tests, then valvetrain.js was restored byte-identical (diff clean).

- [x] G4: full four-stroke sequence per cylinder, 16 valve events, no floating geometry
  CHECK: node --test test/*.test.mjs
  EXPECT: fail 0
  EVIDENCE: exit=0; EXPECT=matched (tests 50 pass 50 fail 0); gate-sig=220797e21f3b9068; output-sha256=33e0a92f36430274826492e0d5dbf3fabd6643ca3e7929b84968a8c11967e8c2
  NOTE (valvetrain unit): closed chain verified in world cm at 8 crank angles: cam face -> bucket top (camBase+lift) -> shim bottom (== valve tip plane) -> retainer top -> spring -> fixed head seat, zero gap; 4 continuous journals x -28.7..29.95 through 7 bearings each; 4x36-tooth sprockets in bands 28.6/28.9/29.2/29.5 sharing the crank sprocket chain pitch (1.204 cm).
  NOTE (heads unit): 50 tests = 41 prior + 9 heads. 120 solids per bank x 2 castings, 16 guides + 16 seat inserts on the timing.js seat/axis points, 16 machined spring-seat floors at guideLength, 28 bosses bored 2.10 over the 2.05 bearings (0.05 running clearance measured off the meshes), 32 head bolts at out 6.3 on the deck rails, 4 covers, 8 copper gasket rings. Valve event window changed to 145..385 / 340..580: measured worst disc-to-crown clearance rose from 0.0885 cm (old 125..405 window, cyl 1 exhaust at 352 deg) to 0.2238 cm (cyl 1 intake at 366 deg). Mutation controls (7): M1 head face +0.5 -> broke the rail/gasket stack; M2 boss bore loses its 0.05 -> broke the running-clearance assert; M3 cover ceiling dropped onto the cams -> broke the cover assert; M4 bucket bore 1.25 too shallow -> broke flange retention; M5 bolt row 6.3 -> 4.0 -> broke the bore-clearance assert; M6 old 280 deg blowdown window back -> broke valve/piston clearance; M7 seat insert OD 2.85 -> 3.20 -> the unit suite SURVIVES it, tmp/clash-heads.mjs catches it as a block-wall clash (radial 5.16 vs the 5.1 bore). All restored byte-identical (sha256 1aa2446e12a21044, diff clean). Harness corrections proven by measurement, not by relaxing: aliased scratch Vector3 in verts(), group-vs-mesh vertex collection, an inverted clearance sign (it demanded the disc sit inside the piston), 1e-6 -> EPS 1e-4 on quaternion-rotated lathes, gasket measured as a ring radius about its own bore axis, station from bbox centre because head meshes bake geometry at position (0,0,0).
  CLASH PROBE (tmp/clash-heads.mjs): NO CLASH. Every head vertex clears the lobe sweep (r > 3.75) inside the lobe x windows and the 1.75 journal outside them; nothing past the 28.6 sprocket band; under-deck hardware hangs inside the 5.1 bore tunnel; closest head-to-crown approach over the whole cycle 0.9714 cm (seat-cyl1-intake, theta 0).

- [x] G4b: manifolds mate to the heads, are equal-length where they must be, and nothing in the pipework floats
  CHECK: node --test test/*.test.mjs
  EXPECT: fail 0
  EVIDENCE: exit=0; EXPECT=matched (tests 62 pass 62 fail 0, manifolds unit 12/12); gate-sig=220797e21f3b9068; output-sha256=156c757ff237654fa18f226375fd85f608fa29264ce7d9595e6bc5673f4c6f67
  NOTE (manifolds unit): 12 tests - build contract (per bank: 4 exhaust flanges + 4 necks + 4 primaries + 2 pairs + 1 collector + outlet flange + 2 shields + 4 clamp bands + 4 stand-offs + 11 beads; 4 intake flanges + 4 necks + 4 runners + 1 plenum + 1 rail + 4 injectors + 4 collars + 2 brackets + 10 beads; 16 bolt instances = 4 ports x 2 holes x 2 sides), flange mating (each exhaust flange sits on the outboard stay face at out 7.00..7.70 with its bore concentric on the port, each intake flange on the inboard face at -7.00..-7.70), equal-length 4-into-1 (merge at exMergeX 11.0 = midpoint of stations 16.5/5.5, so all four primaries travel the same 5.5 cm in x; measured lengths agree within 0.1 %), flow sizing (collector 4.62 cm^2 >= 4 x primary 1.103 cm^2 = 4.41; pairs 2.25 >= 2 x 1.103 = 2.21), voxel-shell clash against block + heads + valvetrain + cranktrain (worst real air >= 0.5 cm, measured 1.694 cm), cam-sweep / crankcase-bay / bore-tunnel bounds, fusion (flange-butts-neck, primary buried in its neck, runner tip buried 3.7 cm past the plenum face - deeper than its own 1.2 cm radius), mounting load paths (tube -> clamp band -> stand-off -> shield with >= 2 stand-off tips buried >= 0.15 cm per shield; bracket cast 0.9 cm into the plenum and embracing the rail; rail clamp hoop buried in its bracket and wrapping the rail; bored injector collar gripping the body and bearing on the rail), staticness (bbox identical over 720 crank degrees) and the 28.6 cam chain band limit.
  MUTATION CONTROLS (tmp/mutate-manifolds.sh): M1 flange past the stay face, M2 flange wider than the stay, M3 merge off the station midpoint, M4 undersized collector, M5 plenum into the cam bosses, M6 plenum into the chain band, M7 neck too long for the primary, M8 one flange bolt hole instead of two, M9 runner short of the plenum, M10 shield swallowing the tubes, M11 shield too short to hold both stand-offs, M12 clamp band too fat to grip its tube, M13 bracket no longer cast into the plenum, M14 bracket off the rail, M15 injector clamp seat off the rail - every one of the 15 turned at least one assertion red, then spec.js + manifolds.js were restored byte-identical (sha256 d32aa7ee31052e03 / b0986c4410e97ab0, `git status` back to the same 4 paths). M8 needed a real physical assert first (a flange held by one bolt pivots and leaks): the bolt pattern is now spec-driven `boltOffsetsAlong` and the test asserts both the pattern length >= 2 and the exact instance count.
  ROOT CAUSE FOUND BY THE TEST (shared helper, src/render/primitives.js): `weldBead` aligned local Y to the curve tangent, but TorusGeometry's hole axis is local Z - so every bead was a hoop tipped into a plane containing the tube, stabbing toward the casting behind the joint (measured 0.256 cm at the exhaust neck collar). Fixed once in the shared helper for all 34+ weld beads, not per call site. `cylinderBetween` also gained length tessellation (1 segment per 1.5 cm): an untessellated cylinder carries vertices only at its two end rings, so vertex-measured contact/clearance against a long tube measures empty space instead of its side.
  CLASH PROBE (tmp/clash-manifolds.mjs): NO CLASH. 134 pipework meshes, 50188 vertices, spatial-hashed against every vertex of block, heads, valvetrain and cranktrain; worst gap 1.694 cm (intake runner weld bead). The probe's vertex-sampled "floating part" half was dropped as a false-positive source (a box face, a rail barrel and a collar ring contact patch all fall between vertices); mounting is measured by the anchor test instead.

- [x] G5: page loads in headless Chromium with zero console errors and a rendered WebGL frame
  CHECK: node test/render.smoke.mjs
  EXPECT: SMOKE OK frames=
  EVIDENCE: exit=0; EXPECT=matched; gate-sig=5b9d984c6064b9f3; output-sha256=d50a28e871d53680a77b105eee860d1aa28b2c97f4e90f7f03f0123491506f9b
  NOTE (heads wired): shell v8-0.6-heads, buffer 1280x713, webgl2 true, drawCalls 1241 (was 671), 20 frames, 0 console errors, 0 warnings, pmrem true, 49 materials, frame mean 33.5 contrast 242.6 stddev 14.9 samples 9409.
  BOOT FRAMING (re-solved after the heads landed): pos (84.4, -117.6, 104.5) lookAt (-2.8, 1.5, 8.1), dist 176.3. Engine bbox in NDC x -0.390..0.359 y -0.733..0.574, centre (0, 0) - nothing cropped, and the head covers now sit centred instead of the old pose's x -0.376..0.370 y -0.822..0.491 offset cy -0.081.
  VISIBLE PARTS (tmp/visible-parts.mjs, 3 poses, drawn-vs-hidden framebuffer difference sampled on real surface vertices, valvetrain unit): union 14/16 lobes, 15/16 buckets, 14/16 shims, 13/16 valves, 13/16 retainers, 14/16 springs, 3/4 camshafts, 3/4 cam sprockets, 21/28 bearing journals, luminance deltas up to 153. The rest are hidden behind the near bank of a solid V - CUTAWAY and EXPLODED turn them into visible evidence (G7).

- [x] G5b: the shell renders the manifolds too, from the angles that show them
  CHECK: node test/render.smoke.mjs
  EXPECT: SMOKE OK frames=
  EVIDENCE: exit=0; EXPECT=matched (SMOKE OK frames=19 errors=0 warnings=0); gate-sig=5b9d984c6064b9f3; output-sha256=c01e2aac782302736b865fecd12c239c968c006c2c214a126ef631e767708044
  NOTE (manifolds wired): shell v8-0.7-manifolds, buffer 1280x713, webgl2 true, drawCalls 1513 (was 1241), 19 frames, 0 console errors, 0 warnings, pmrem true, 49 materials, mean 33.5 contrast 219.4 stddev 15.2 samples 9409. Engine bbox after the pipework landed: bank-local out to 18.2 (shield outer face), crank-axis extent x +-22.0 (plenum), collector outlet at out 17.2 / x -9.0.
  BOOT FRAMING (re-solved after the manifolds landed, /tmp/opencode/last-v8/frame-check.mjs --solve): pos (84.4, -117.6, 104.5) lookAt (-3.0, 1.8, 8.6), dist 176.3. Engine bbox in NDC x -0.393..0.360 y -0.744..0.580, centre (0, 0) - nothing cropped by the collectors or the plenum.
  MULTI-ANGLE EVIDENCE (tmp/shot-angles.mjs, 4 posed cameras above the cell floor, 0 CDP errors, every buffer 1280x713): 02-exhaust-L mean 45.8 contrast 253.1, 03-exhaust-R 29.1/251.1, 04-intake-V 40.3/254.7, 05-collector 27.4/251.9. All four shots were read as images: bank-local 4-into-1 primaries visible leaving the outboard head faces and merging at x 11.0 into the collectors, the plenum bar and four runners hanging in the V, the rail under the plenum with its brackets and four injectors angled at their own cylinders, and the heat shields outboard of the tubes on their clamp bands.

- [ ] G6: every control (START/STOP, RPM, SLOW-MO, CUTAWAY, EXPLODED, ASSEMBLE, INSPECT, RESET CAMERA) is functional
  CHECK: node test/controls.smoke.mjs
  EXPECT: CONTROLS OK
  EVIDENCE: pending

- [ ] G7: screenshots show pistons inside bores, rods on the crank, no detached parts
  CHECK: node test/screenshots.mjs
  EXPECT: SHOTS OK
  EVIDENCE: pending
