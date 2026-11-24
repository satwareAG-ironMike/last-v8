// Release identity gates for v8.0.0 on the `v8` branch ("Last V8" plus the mechanical
// addendum of issue #8). One truth, four surfaces: the npm package version, the shell stamp
// the browser reads, the demo path the README and the deploy contract publish, and the
// origin thread HISTORY carries. A release where these disagree is exactly the
// artifact-honesty failure this ledger exists to catch, so every value here is read from its
// own file and compared - no surface is allowed to remember a number.
//
// Ported from the shape the v12 tree uses (same four surfaces, one constant). It is a port,
// not a merge: the strings are this branch's, including the 90 degree cross-plane V8 the
// description has to tell the truth about.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const pkg = JSON.parse(read('package.json'));

// The version being cut. The git tag, the GitHub release title ("Last V8 v8.0.0") and every
// string below follow this one constant.
const RELEASE = '8.0.0';

test('package version is the release version and the description names the engine it is', () => {
  assert.equal(pkg.version, RELEASE, `package.json version must be the cut version, reads ${pkg.version}`);
  assert.match(pkg.description, /cross-plane 90 degree V8/, `the description must name this build: ${pkg.description}`);
});

test('the shell stamp the browser reads is v + package version (window.__v8.version)', () => {
  const m = read('src/main.js').match(/window\.__v8\s*=\s*\{\s*version:\s*'([^']+)'/);
  assert.ok(m, 'no window.__v8 version stamp found in src/main.js, so the page publishes no identity to compare');
  assert.equal(m[1], `v${pkg.version}`, `the stamp the shell reports (${m[1]}) must not lag the package version (v${pkg.version})`);
});

test('the demo path: README and the deploy contract name the same V8 poc', () => {
  const demo = 'michael.wegener.engineering/projects/last-v8/poc/';
  assert.ok(read('README.md').includes(demo), 'README live demo must point at projects/last-v8/poc/');
  assert.ok(read('specs/deploy.md').includes(demo), 'the deploy contract must publish the same path the README does');
});

test('HISTORY cites the challenge thread this build came out of', () => {
  const h = read('HISTORY.md');
  assert.ok(h.includes('x.com/Bassmaster187/status/2120435922797748522'),
    'the origin thread URL must be cited, or the release cannot say where it came from');
  assert.match(h, /90-degree V8|90 degree V8/, 'the origin must name what was asked for, not just who asked');
});
