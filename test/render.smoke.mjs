// G5 oracle: serve the app, boot it in headless Chromium over raw CDP (no
// puppeteer: Node 24 global fetch + WebSocket talk DevTools directly), then
// assert zero console/CDP errors, a real WebGL2 context, animation frames,
// and a non-blank rendered buffer; saves shots/01-shell-boot.png as evidence.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startServer } from '../scripts/serve.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const CHROMIUM = [
  process.env.CHROMIUM_BIN,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async open() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('message', (ev) =>
      this.dispatch(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'))
    );
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res);
      this.ws.addEventListener('error', () => rej(new Error('CDP websocket connect failed')));
    });
    return this;
  }
  dispatch(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { res, rej } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) rej(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
      else res(msg.result);
      return;
    }
    for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params ?? {});
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      const t = setTimeout(() => {
        if (this.pending.delete(id)) rej(new Error(`CDP timeout: ${method}`));
      }, 30000);
      t.unref();
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

const watchdog = setTimeout(() => {
  console.error('SMOKE FAIL: watchdog expired');
  process.exit(1);
}, 90000);
watchdog.unref();

const fail = (why) => {
  console.error(`SMOKE FAIL: ${why}`);
  process.exitCode = 1;
};

if (!CHROMIUM) {
  fail('no chromium binary found (set CHROMIUM_BIN)');
  process.exit(1);
}

const server = await startServer(0);
const pageUrl = `http://127.0.0.1:${server.address().port}/`;
const profile = mkdtempSync(join(tmpdir(), 'v8-smoke-'));

let browser = null;
let cdp = null;
try {
  browser = spawn(
    CHROMIUM,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-dev-shm-usage',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      '--window-size=1280,800',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );

  let errBuf = '';
  let debugPort = 0;
  browser.stderr.on('data', (d) => {
    errBuf += d;
    const m = errBuf.match(/ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser/);
    if (m) debugPort = Number(m[1]);
  });
  for (let i = 0; i < 60 && !debugPort; i++) {
    if (browser.exitCode !== null) throw new Error(`chromium exited early:\n${errBuf.slice(-1200)}`);
    await sleep(250);
  }
  if (!debugPort) throw new Error(`no CDP endpoint:\n${errBuf.slice(-1200)}`);

  let page = null;
  for (let i = 0; i < 40 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* not up yet */
    }
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('no CDP page target');

  cdp = await new Cdp(page.webSocketDebuggerUrl).open();

  const errors = [];
  const warnings = [];
  cdp.on('Runtime.exceptionThrown', (p) =>
    errors.push(`exception: ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'unknown'}`)
  );
  cdp.on('Runtime.consoleAPICalled', (p) => {
    const text = (p.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    if (p.type === 'error') errors.push(`console.error: ${text}`);
    else if (p.type === 'warning') warnings.push(`console.warn: ${text}`);
  });
  cdp.on('Log.entryAdded', (p) => {
    const e = p.entry ?? {};
    if (e.level === 'error') errors.push(`log[${e.source}]: ${e.text}`);
    else if (e.level === 'warning') warnings.push(`log[${e.source}]: ${e.text}`);
  });
  cdp.on('Inspector.targetCrashed', () => errors.push('page target crashed (WebGL/GPU failure)'));

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  const loaded = new Promise((res, rej) => {
    cdp.on('Page.loadEventFired', res);
    const t = setTimeout(() => rej(new Error('page load event timeout')), 25000);
    t.unref();
  });
  await cdp.send('Page.navigate', { url: pageUrl });
  await loaded;

  const evalJs = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails)
      throw new Error(`eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };

  for (let i = 0; i < 60; i++) {
    if ((await evalJs('window.__v8 && typeof window.__v8.frameCount === "function" ? window.__v8.frameCount() : -1')) >= 8)
      break;
    if (i === 59) throw new Error('window.__v8 never produced 8 animation frames');
    await sleep(250);
  }

  const stats = JSON.parse(await evalJs('JSON.stringify(window.__v8.grabFrame())'));
  const version = await evalJs('window.__v8.version');
  const envOk = await evalJs('window.__v8.scene.environment ? window.__v8.scene.environment.isPMREMTexture === true || !!window.__v8.scene.environment.mapping : false');
  const materialCount = await evalJs('Object.keys(window.__v8.materials).length');

  const shotDir = join(ROOT, 'shots');
  mkdirSync(shotDir, { recursive: true });
  const shotPath = join(shotDir, '01-shell-boot.png');
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));

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
} catch (err) {
  fail(err.message);
} finally {
  clearTimeout(watchdog);
  if (cdp) cdp.close();
  if (browser && browser.exitCode === null) browser.kill('SIGKILL');
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
