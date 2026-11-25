// Procedural-only audit: prove the product draws everything from code. Static text and
// hashing over src/ and public/ - it runs no browser and touches no product runtime, so it
// can run at any time. It measures what the GATES.md G7 row claims under PROCEDURAL
// GEOMETRY ONLY: no loader of any kind, no image or model asset reference, no network call
// from the product, the dependency set, which three addons are imported and from where, the
// canvas law that builds the PBR maps, and the one data: URI in the product.
//
// Written because the G7 row cites tmp/procedural-audit.out, a scratch output whose
// generator was scratch too - the same class of problem the hygiene commit declared for the
// two boot-framing citations. This file is the committed form of that measurement, so the
// claim can be recomputed instead of trusted.
//
// Counting definitions, stated because the two kinds of number in this file mean different
// things:
//   the canvas law is counted as canvas-creation lines plus 2D-context lines in
//     src/render/materials.js, and the sum this file prints is what the G7 row's
//     "canvas 2D contexts" records;
//   the mesh / material-family / texture-map census of the drawn scene is NOT countable
//     statically, because the map families are built in loops. It is a live count, printed
//     from the rendered tree by the committed gate test/screenshots.mjs, and that gate owns
//     it: this file prints none of it. A number copied out of another gate's transcript is a
//     claim this tool can neither re-derive nor notice going stale - which is exactly what
//     happened to the census line this file used to end with (issue #14).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
};

const files = [...walk('src'), ...walk('public')].filter((f) => /\.(js|mjs|html|css|json)$/.test(f));
const scan = (re) => {
  const hits = [];
  for (const f of files) {
    readFileSync(f, 'utf8')
      .split('\n')
      .forEach((ln, i) => {
        if (re.test(ln)) hits.push(`${f}:${i + 1}: ${ln.trim().slice(0, 100)}`);
      });
  }
  return hits;
};

// No wall clock in the header: issue #43 measured that a record of this gate
// hashed differently on every run because of this stamp alone, and a hash a GATES.md
// row cites has to stay re-derivable (the reason scripts/ledger-run.sh strips node's
// own duration stamps). The audit is a static scan; a timestamp says nothing about
// its verdict.
console.log('== procedural-only audit (static) ==');
console.log(`files scanned: ${files.length} under src/ and public/`);

let total = 0;
for (const [label, re] of [
  ['loaders (any kind)', /\b\w*(Texture|GLTF|FBX|OBJ|HDR|EXR|Cube|Image|File|Animation|Material)Loader\b/],
  ['image or model asset reference', /['"][^'"]*\.(png|jpe?g|gif|webp|bmp|tga|dds|hdr|exr|glb|gltf|fbx|obj)['"]/],
  ['network from the product', /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|EventSource|import\(['"]https?:/],
  ['remote import or URL literal', /from\s+['"]https?:|['"]https?:\/\/[^'"]*\.(png|jpg|hdr|glb|gltf|js|mjs)['"]/],
]) {
  const hits = scan(re);
  total += hits.length;
  console.log(`-- ${label}: ${hits.length ? '' : 'none'}`);
  for (const h of hits) console.log(`   ${h}`);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
console.log(`-- dependencies: ${JSON.stringify(pkg.dependencies ?? {})}; devDependencies: ${JSON.stringify(pkg.devDependencies ?? null)}`);

const addons = [...scan(/from\s+['"]three\/(addons|examples)\/[^'"]+['"]/g)].map((h) => {
  const [, spec] = h.match(/from\s+['"](three\/(?:addons|examples)\/[^'"]+)['"]/);
  return `${spec} <- ${h.split(':')[0]}:${h.split(':')[1]}`;
});
console.log(`-- three addons imported: ${addons.length}`);
for (const a of new Set(addons)) console.log(`   ${a}`);

const mat = readFileSync('src/render/materials.js', 'utf8');
const created = (mat.match(/document\.createElement\('canvas'\)/g) || []).length;
const contexts = (mat.match(/getContext\('2d'\)/g) || []).length;
console.log(
  `-- canvas law in src/render/materials.js: ${created} canvas creations + ${contexts} 2D contexts = ${created + contexts} ` +
    `(the "15 canvas 2D contexts" of the G7 row is this sum)`,
);
console.log(
  `-- map plumbing there: ${(mat.match(/CanvasTexture/g) || []).length} CanvasTexture, ` +
    `${(mat.match(/PMREMGenerator|fromEquirectangular/g) || []).length} PMREM calls, ` +
    `${(mat.match(/\benvMap\b/g) || []).length} envMap references`,
);
console.log('-- live scene census (meshes, material families, texture maps) is measured from the rendered tree by test/screenshots.mjs, which owns it; this file scans text and prints none of it'); // issue #14

const dataUris = scan(/data:[a-z]+\/[a-z0-9.+-]+/i);
console.log(`-- data: URIs in the product: ${dataUris.length}`);
for (const d of dataUris) console.log(`   ${d}`);

console.log(`\n${total === 0 ? 'PROCEDURAL ONLY' : `PROBLEM: ${total} forbidden hits`}`);

// The verdict is also the exit code (issue #34): row G7's CHECK runs this file, and a gate
// whose CHECK cannot fail is a comment rather than a gate. Before this line both states
// reported success, so a forbidden hit in the product was only ever readable off a transcript.
process.exitCode = total === 0 ? 0 : 1;
