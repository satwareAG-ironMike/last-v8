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

- [x] G5: page loads in headless Chromium with zero console errors and a rendered WebGL frame
  CHECK: node test/render.smoke.mjs
  EXPECT: SMOKE OK frames=
  EVIDENCE: exit=0; EXPECT=matched; gate-sig=5b9d984c6064b9f3; output-sha256=d50a28e871d53680a77b105eee860d1aa28b2c97f4e90f7f03f0123491506f9b
  NOTE (heads wired): shell v8-0.6-heads, buffer 1280x713, webgl2 true, drawCalls 1241 (was 671), 20 frames, 0 console errors, 0 warnings, pmrem true, 49 materials, frame mean 33.5 contrast 242.6 stddev 14.9 samples 9409.
  BOOT FRAMING (re-solved after the heads landed): pos (84.4, -117.6, 104.5) lookAt (-2.8, 1.5, 8.1), dist 176.3. Engine bbox in NDC x -0.390..0.359 y -0.733..0.574, centre (0, 0) - nothing cropped, and the head covers now sit centred instead of the old pose's x -0.376..0.370 y -0.822..0.491 offset cy -0.081.
  VISIBLE PARTS (tmp/visible-parts.mjs, 3 poses, drawn-vs-hidden framebuffer difference sampled on real surface vertices, valvetrain unit): union 14/16 lobes, 15/16 buckets, 14/16 shims, 13/16 valves, 13/16 retainers, 14/16 springs, 3/4 camshafts, 3/4 cam sprockets, 21/28 bearing journals, luminance deltas up to 153. The rest are hidden behind the near bank of a solid V - CUTAWAY and EXPLODED turn them into visible evidence (G7).

- [ ] G6: every control (START/STOP, RPM, SLOW-MO, CUTAWAY, EXPLODED, ASSEMBLE, INSPECT, RESET CAMERA) is functional
  CHECK: node test/controls.smoke.mjs
  EXPECT: CONTROLS OK
  EVIDENCE: pending

- [ ] G7: screenshots show pistons inside bores, rods on the crank, no detached parts
  CHECK: node test/screenshots.mjs
  EXPECT: SHOTS OK
  EVIDENCE: pending
