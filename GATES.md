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
  EVIDENCE: exit=0; EXPECT=matched; gate-sig=af27c64b39beac1f; output-sha256=babba287446ac173ca94c08842da695e1f4f412da6b46a211ed6c63a51ad4ad8

- [x] G4: full four-stroke sequence per cylinder, 16 valve events, no floating geometry
  CHECK: node --test test/*.test.mjs
  EXPECT: fail 0
  EVIDENCE: exit=0; EXPECT=matched; gate-sig=af27c64b39beac1f; output-sha256=2fd64479ebb0e3c75985002050efcd75e6382ed48ba15a64744b8d8b0ffbf163

- [x] G5: page loads in headless Chromium with zero console errors and a rendered WebGL frame
  CHECK: node test/render.smoke.mjs
  EXPECT: SMOKE OK frames=
  EVIDENCE: exit=0; EXPECT=matched; gate-sig=b426f36a9d747473; output-sha256=7f059ccb84c3376b0f47ba265cd505e4e6985c06e3ee081aa67848a7dafc7082

- [ ] G6: every control (START/STOP, RPM, SLOW-MO, CUTAWAY, EXPLODED, ASSEMBLE, INSPECT, RESET CAMERA) is functional
  CHECK: node test/controls.smoke.mjs
  EXPECT: CONTROLS OK
  EVIDENCE: pending

- [ ] G7: screenshots show pistons inside bores, rods on the crank, no detached parts
  CHECK: node test/screenshots.mjs
  EXPECT: SHOTS OK
  EVIDENCE: pending
