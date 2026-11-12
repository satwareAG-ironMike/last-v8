// G5 oracle: serve the app, boot it in headless Chromium over raw CDP (machinery
// in test/support/browser.mjs), then assert zero console/CDP errors, a real WebGL2
// context, animation frames, and a non-blank rendered buffer; saves
// shots/01-shell-boot.png as evidence.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHROMIUM, ROOT, withPage } from './support/browser.mjs';

const fail = (why) => {
  console.error(`SMOKE FAIL: ${why}`);
  process.exitCode = 1;
};

try {
  await withPage({ minFrames: 8, watchdogMs: 90000 }, async ({ evalJs, capture, pageUrl, errors, warnings }) => {
    const stats = JSON.parse(await evalJs('JSON.stringify(window.__v8.grabFrame())'));
    const version = await evalJs('window.__v8.version');
    const envOk = await evalJs('window.__v8.scene.environment ? window.__v8.scene.environment.isPMREMTexture === true || !!window.__v8.scene.environment.mapping : false');
    const materialCount = await evalJs('Object.keys(window.__v8.materials).length');

    const shotDir = join(ROOT, 'shots');
    mkdirSync(shotDir, { recursive: true });
    const shotPath = join(shotDir, '01-shell-boot.png');
    writeFileSync(shotPath, await capture());

    console.log(`chromium: ${CHROMIUM}`);
    console.log(`page:     ${pageUrl} (shell ${version})`);
    console.log(`gl:       webgl2=${stats.webgl2} buffer=${stats.width}x${stats.height} drawCalls=${stats.drawCalls}`);
    console.log(`env:      pmrem=${envOk} materials=${materialCount}`);
    console.log(
      `frame:    mean=${stats.mean.toFixed(1)} min=${stats.min.toFixed(1)} max=${stats.max.toFixed(1)} contrast=${stats.contrast.toFixed(1)} stddev=${stats.stddev.toFixed(1)} samples=${stats.samples}`
    );
    console.log(`screenshot: ${shotPath} (${existsSync(shotPath) ? 'written' : 'MISSING'})`);
    if (warnings.length) console.log(`warnings: ${warnings.length} (${warnings.slice(0, 3).join(' | ')})`);

    if (errors.length) throw new Error(`${errors.length} console/CDP error(s):\n  ${errors.join('\n  ')}`);
    if (!stats.webgl2) throw new Error('renderer is not WebGL2');
    if (stats.frames < 9) throw new Error(`too few frames: ${stats.frames}`);
    if (stats.mean < 5 || stats.mean > 250) throw new Error(`frame mean out of range: ${stats.mean}`);
    if (stats.contrast < 40) throw new Error(`blank frame: contrast ${stats.contrast}`);
    if (stats.stddev < 8) throw new Error(`uniform frame: stddev ${stats.stddev}`);
    if (stats.drawCalls < 5) throw new Error(`too few draw calls: ${stats.drawCalls}`);
    if (!existsSync(shotPath)) throw new Error('screenshot missing');

    console.log(`SMOKE OK frames=${stats.frames} errors=0 warnings=${warnings.length} shot=${shotPath}`);
  });
} catch (err) {
  fail(err.message);
}
