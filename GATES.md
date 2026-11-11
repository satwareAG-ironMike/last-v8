# Gates: V8 test-stand simulation

OWNS: src/**, test/**, public/**

- [ ] G1: cross-plane firing order derives from geometry as 1-8-7-3-6-5-4-2, 90 deg apart
  CHECK: node --test test/
  EXPECT: pass 8
  EVIDENCE: pending

- [ ] G2: piston/rod/crank kinematics conserve rod length at every crank angle
  CHECK: node --test test/
  EXPECT: pass 8
  EVIDENCE: pending

- [ ] G3: camshafts turn at exactly half crank speed and valve lift comes from the cam lobe profile
  CHECK: node --test test/
  EXPECT: pass 8
  EVIDENCE: pending

- [ ] G4: full four-stroke sequence per cylinder, 16 valve events, no floating geometry
  CHECK: node --test test/
  EXPECT: pass 8
  EVIDENCE: pending

- [ ] G5: page loads in headless Chromium with zero console errors and a rendered WebGL frame
  CHECK: node test/render.smoke.mjs
  EXPECT: SMOKE OK frames=
  EVIDENCE: pending

- [ ] G6: every control (START/STOP, RPM, SLOW-MO, CUTAWAY, EXPLODED, ASSEMBLE, INSPECT, RESET CAMERA) is functional
  CHECK: node test/controls.smoke.mjs
  EXPECT: CONTROLS OK
  EVIDENCE: pending

- [ ] G7: screenshots show pistons inside bores, rods on the crank, no detached parts
  CHECK: node test/screenshots.mjs
  EXPECT: SHOTS OK
  EVIDENCE: pending
