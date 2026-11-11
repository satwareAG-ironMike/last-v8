# Gates: V8 test-stand simulation

OWNS: src/**, test/**, public/**

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
  EVIDENCE: exit=0; EXPECT=matched; gate-sig=af27c64b39beac1f; output-sha256=83374c4aeb961ca7d9d15ef931ff0637f075c5de34e8f14ea58fb5765737a7f5
  NOTE (valvetrain unit): closed chain verified in world cm at 8 crank angles: cam face -> bucket top (camBase+lift) -> shim bottom (== valve tip plane) -> retainer top -> spring -> fixed head seat, zero gap; 4 continuous journals x -28.7..29.95 through 7 bearings each; 4x36-tooth sprockets in bands 28.6/28.9/29.2/29.5 sharing the crank sprocket chain pitch (1.204 cm).

- [x] G5: page loads in headless Chromium with zero console errors and a rendered WebGL frame
  CHECK: node test/render.smoke.mjs
  EXPECT: SMOKE OK frames=
  EVIDENCE: exit=0; EXPECT=matched; gate-sig=b426f36a9d747473; output-sha256=d031156f40de8527491f5296960b58442e84cdf56dacfc0ff17c571fcfa08f2a
  NOTE (valvetrain wired): shell v8-0.5-valvetrain, buffer 1280x713, drawCalls 671 (was 343), 16 frames, 0 errors, 0 warnings, frame mean 32.8 contrast 253 stddev 15.6.
  BOOT FRAMING: swept 12 candidate poses, scoring the engine bbox in NDC plus the number of valvetrain parts visible on screen. Shipped pose pos (84.4, -117.6, 104.5) lookAt (-3.3, -0.4, 16): NDC x -0.374..0.368 y -0.818..0.486 (nothing cropped, headroom kept for manifolds/stand), 41 valvetrain parts visible where the previous pose showed 16; frame mean rose 26.3 -> 32.8.
  VISIBLE PARTS (tmp/visible-parts.mjs, 3 poses, drawn-vs-hidden framebuffer difference sampled on real surface vertices): union 14/16 lobes, 15/16 buckets, 14/16 shims, 13/16 valves, 13/16 retainers, 14/16 springs, 3/4 camshafts, 3/4 cam sprockets, 21/28 bearing journals, luminance deltas up to 153. The rest are hidden behind the near bank of a solid V - CUTAWAY and EXPLODED turn them into visible evidence (G7).

- [ ] G6: every control (START/STOP, RPM, SLOW-MO, CUTAWAY, EXPLODED, ASSEMBLE, INSPECT, RESET CAMERA) is functional
  CHECK: node test/controls.smoke.mjs
  EXPECT: CONTROLS OK
  EVIDENCE: pending

- [ ] G7: screenshots show pistons inside bores, rods on the crank, no detached parts
  CHECK: node test/screenshots.mjs
  EXPECT: SHOTS OK
  EVIDENCE: pending
