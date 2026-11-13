// Shared headless-browser machinery for the render gates (G5, G6, G7): serve the
// app, boot headless Chromium over raw CDP (no puppeteer: Node 24 global fetch +
// WebSocket talk DevTools directly), collect every console/CDP error, wait until
// the app has actually produced animation frames, and hand the caller a live page.
//
// Teardown is unconditional: the browser, the DevTools socket, the static server
// and the throw-away profile all go down in `finally`, because a leaked headless
// Chromium eats the box on the next gate run. Chromium flags learned the hard way:
// `--enable-unsafe-swiftshader` is what makes WebGL exist at all in a headless
// container, and `--remote-allow-origins=*` is what lets the WebSocket connect.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startServer } from '../../scripts/serve.mjs';

export const ROOT = resolve(import.meta.dirname, '../..');

export const CHROMIUM = [
  process.env.CHROMIUM_BIN,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Cdp {
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
  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      const t = setTimeout(() => {
        if (this.pending.delete(id))
          rej(new Error(`CDP timeout: ${method} did not answer within ${timeoutMs} ms`));
      }, timeoutMs);
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

/**
 * Boot the app and run `fn` against it.
 *
 * @param {{watchdogMs?:number, minFrames?:number, window?:string}} [opts]
 * @param {(page:{evalJs:Function, capture:Function, pageUrl:string,
 *   errors:string[], warnings:string[], server:import('node:http').Server}) => any} fn
 * @returns the value `fn` returned
 */
export async function withPage(opts = {}, fn) {
  if (!CHROMIUM) throw new Error('no chromium binary found (set CHROMIUM_BIN)');
  const watchdogMs = opts.watchdogMs ?? 120000;
  const minFrames = opts.minFrames ?? 8;
  const win = opts.window ?? '1280,800';

  const watchdog = setTimeout(() => {
    console.error('WATCHDOG EXPIRED: the browser gate never finished');
    teardown();
    process.exit(1);
  }, watchdogMs);
  watchdog.unref();

  const server = await startServer(0);
  const pageUrl = `http://127.0.0.1:${server.address().port}/`;
  const profile = mkdtempSync(join(tmpdir(), 'v12-browser-'));
  let browser = null;
  let cdp = null;
  const errors = [];
  const warnings = [];

  /**
   * Puts the browser, the DevTools socket, the server and the throw-away profile back
   * in the box. The watchdog and the finally share ONE teardown: process.exit() skips
   * finally blocks, and a gate that times out without killing its headless Chromium
   * leaves a SwiftShader gpu-process (~390 MB) burning a core for every gate that runs
   * afterwards - measured consequence: load average 25 on 16 cores, and the next gate
   * timed out because the machine was busy (tmp/g6-run11.out).
   */
  const teardown = () => {
    clearTimeout(watchdog);
    if (cdp) cdp.close();
    if (browser && browser.exitCode === null) browser.kill('SIGKILL');
    server.close();
    rmSync(profile, { recursive: true, force: true });
  };

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
        `--window-size=${win}`,
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

    const evalJs = async (expression, opts = {}) => {
      // awaitPromise: the gates read published constants out of the app's own
      // modules, which needs a dynamic import to resolve before the value comes back
      const r = await cdp.send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        opts.timeoutMs ?? 30000
      );
      if (r.exceptionDetails)
        throw new Error(`eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      return r.result.value;
    };

    for (let i = 0; i < 60; i++) {
      const frames = await evalJs('window.__v12 && typeof window.__v12.frameCount === "function" ? window.__v12.frameCount() : -1');
      if (frames >= minFrames) break;
      if (i === 59) throw new Error(`window.__v12 never produced ${minFrames} animation frames`);
      await sleep(250);
    }

    const capture = async () => {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(shot.data, 'base64');
    };

    // `cdp` is handed over on purpose: the control gate (G6) drives the page through
    // raw DevTools INPUT events (mouse press/move/release, key up/down, wheel), which
    // is what makes "every control functional" a claim about the real UI rather than
    // about a convenience API called from the test.
    return await fn({ evalJs, capture, pageUrl, errors, warnings, server, cdp });
  } finally {
    teardown();
  }
}
