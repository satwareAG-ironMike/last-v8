// Release identity gates for v12.0.0 ("Last V12"). One truth, four surfaces:
// the npm package version, the shell stamp the browser reads, the demo URL the
// README and the deploy contract publish, and the origin citation HISTORY
// carries. A release where these disagree is exactly the artifact-honesty
// failure the ledger exists to catch, so the test reads each surface from its
// file and compares - no surface is allowed to remember the V8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const pkg = JSON.parse(read('package.json'));

// The version being cut. The git tag, the GitHub release title ("Last V12
// v12.0.0") and every string below follow this one constant.
const RELEASE = '12.0.0';

test('package version is the release version, description tells the truth', () => {
  assert.equal(pkg.version, RELEASE, 'package.json version must be the cut version');
  assert.match(pkg.description, /60 degree DOHC V12/, 'description must name the V12');
});

test('the shell stamp equals v + package version (window.__v12.version)', () => {
  const m = read('src/main.js').match(/window\.__v12\s*=\s*\{\s*version:\s*'([^']+)'/);
  assert.ok(m, 'no window.__v12 version stamp found in src/main.js');
  assert.equal(m[1], `v${pkg.version}`, 'stamp must not lag the package version');
});

test('demo URL: README and the deploy contract name the same V12 path', () => {
  const demo = 'michael.wegener.engineering/projects/last-v12/poc/';
  assert.ok(read('README.md').includes(demo), 'README live demo must point at last-v12/poc');
  assert.ok(read('specs/deploy.md').includes(demo), 'deploy contract must publish the same path');
});

test('HISTORY carries the X request that triggered the V12', () => {
  const h = read('HISTORY.md');
  assert.ok(h.includes('x.com/boardyai/status/2121020098358259782'),
    'the origin post URL must be cited');
  assert.ok(h.includes('i want the v12'), 'the request itself must be quoted');
});
