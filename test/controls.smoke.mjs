// G6 oracle: EVERY control of the objective is driven through the real UI.
//
// The buttons are clicked with DevTools INPUT events at their real screen
// coordinates, the RPM slider is moved with real arrow keys, slow motion is changed
// with real arrow keys on the real <select>, the camera is orbited with a real press
// and drag and zoomed with a real wheel, and a part is inspected by clicking it in
// the 3D view. Nothing here calls the convenience API to make a control "work": each
// claim is made after a real user gesture, and each is read back from the simulation
// state and from the DOM that the user actually looks at.
//
// The controls are also checked against the published authorities: the slider's
// bounds are read out of the app's own animation module, the slow-motion options are
// clamped by the state module, the PART INSPECTION menu is the scene's own inspectable
// members, and the cycle readout is compared against the crank angle it claims to show.
//
// Finally the whole cycle is undone: assembled geometry, draw calls and the frame
// region must come back identical, because a control that leaves something floating
// apart is a broken control.
import { CHROMIUM, ROOT, withPage } from './support/browser.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (n) => +n.toFixed(2);

/** One keyboard press, down and up, as a real key event on the focused element. */
const KEYS = {
  w: ['w', 'KeyW', 87],
  a: ['a', 'KeyA', 65],
  s: ['s', 'KeyS', 83],
  d: ['d', 'KeyD', 68],
  q: ['q', 'KeyQ', 81],
  e: ['e', 'KeyE', 69],
  r: ['r', 'KeyR', 82],
  ArrowRight: ['ArrowRight', 'ArrowRight', 39],
  ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37],
  ArrowUp: ['ArrowUp', 'ArrowUp', 38],
  ArrowDown: ['ArrowDown', 'ArrowDown', 40],
  Home: ['Home', 'Home', 36],
  End: ['End', 'End', 35],
};

// Everything inside these backticks runs in the PAGE, so every helper it uses has to
// be declared inside it. A helper that only exists in the Node scope of this file is a
// ReferenceError at line 1 of the evaluated snippet.
const SNAP = `(() => {
  const r2 = (n) => +n.toFixed(2);
  const v = window.__v12, THREE = v.THREE;
  const txt = (id) => { const e = document.getElementById(id); return e ? e.textContent : null; };
  const attr = (id, name) => { const e = document.getElementById(id); return e ? e.getAttribute(name) : null; };
  const sel = document.getElementById('part-select');
  const pose = v.cameraPose();
  const vs = v.viewState();
  const box = new THREE.Box3().setFromObject(v.engine);
  const stats = v.grabFrame();
  return {
    hud: txt('status'),
    runLabel: txt('btn-run'), runPressed: attr('btn-run', 'aria-pressed'),
    rpm: Number(document.getElementById('rpm').value),
    rpmMin: document.getElementById('rpm').min, rpmMax: document.getElementById('rpm').max,
    rpmOut: txt('rpm-out'),
    slowmoSel: Number(document.getElementById('slowmo').value),
    slowmoLabel: document.getElementById('slowmo').selectedOptions[0].textContent,
    stateRpm: v.state.rpm, stateSlowmo: v.state.slowmo, running: v.state.running, theta: v.state.theta,
    cutPressed: attr('btn-cut', 'aria-pressed'),
    explodePressed: attr('btn-explode', 'aria-pressed'),
    assemblePressed: attr('btn-assemble', 'aria-pressed'),
    inspectPressed: attr('btn-inspect', 'aria-pressed'),
    menuSize: sel.options.length, selected: sel.value, selectedLabel: sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : null,
    cycle: txt('cycle-out'),
    view: {
      cutaway: vs.cutaway,
      fraction: +vs.fraction.toFixed(6),
      moved: vs.moved,
      inspected: vs.inspected,
      frameRange: vs.frameRange ?? null,
      cutawayPlane: vs.cutawayPlane ? { normal: vs.cutawayPlane.normal, constant: +vs.cutawayPlane.constant.toFixed(6) } : null,
      engineZ: r2(vs.engineZ),
    },
    pose: { az: +pose.az.toFixed(4), el: +pose.el.toFixed(4), dist: r2(pose.dist), eye: pose.eye.toArray().map(r2), focus: pose.focus.toArray().map(r2) },
    outlines: v.scene.children.filter((o) => o.name === 'inspect-outline').length,
    calls: stats.drawCalls, webgl2: stats.webgl2, buffer: stats.width + 'x' + stats.height, frames: stats.frames,
    live: { min: [box.min.x, box.min.y, box.min.z].map(r2), max: [box.max.x, box.max.y, box.max.z].map(r2) },
    active: document.activeElement ? document.activeElement.id || document.activeElement.tagName : null,
  };
})()`;

const fail = (why) => {
  console.error(`CONTROLS FAIL: ${why}`);
  process.exitCode = 1;
};

try {
  await withPage({ minFrames: 8, watchdogMs: 900000 }, async ({ evalJs, capture, pageUrl, errors, warnings, cdp }) => {
    const bad = [];
    const note = (t) => console.log(t);

    const rectOf = async (sel) =>
      JSON.parse(
        await evalJs(
          `JSON.stringify((() => { const e = document.querySelector(${JSON.stringify(
            sel
          )}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), tag: e.tagName }; })())`
        )
      );

    // A real pointer press and release at the control's own screen coordinates.
    const clickAt = async (x, y) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    };
    const clickControl = async (sel) => {
      const r = await rectOf(sel);
      if (!r) throw new Error(`control ${sel} is not in the page`);
      await clickAt(r.x, r.y);
      await sleep(120);
      return r;
    };
    const pressKey = async (name) => {
      const [key, code, vk] = KEYS[name];
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      await sleep(60);
    };
    // Held key: down, let the loop walk for a while, then up.
    const holdKey = async (name, ms) => {
      const [key, code, vk] = KEYS[name];
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      await sleep(ms);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      await sleep(120);
    };
    // The page's own viewport, measured rather than assumed, so a canvas gesture
    // lands where the user's cursor would land.
    const vp = JSON.parse(await evalJs('JSON.stringify({ w: window.innerWidth, h: window.innerHeight })'));
    /** Focus a control with Tab presses only: keyboard operability, and it keeps a
     * native <select> popup closed, which a click would open and headless cannot hit. */
    const focusById = async (id) => {
      for (let i = 0; i < 24; i++) {
        const active = await evalJs('JSON.stringify(document.activeElement ? document.activeElement.id || document.activeElement.tagName : null)');
        if (JSON.parse(active) === id) return true;
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Tab',
          code: 'Tab',
          windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9,
        });
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Tab',
          code: 'Tab',
          windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9,
        });
        await sleep(60);
      }
      return false;
    };
    const snap = async (label) => {
      const s = JSON.parse(await evalJs(`JSON.stringify(${SNAP})`));
      note(
        `${label.padEnd(30)} run=${s.runLabel}/${s.runPressed} rpm=${s.rpm}->${s.stateRpm} slowmo=${s.stateSlowmo} ` +
          `frac=${s.view.fraction} moved=${s.view.moved} cut=${s.view.cutaway} insp=${s.view.inspected} outlines=${s.outlines} ` +
          `dist=${s.pose.dist} focus=${s.pose.focus.join(',')} active=${s.active}`
      );
      note(`${' '.repeat(33)}hud="${s.hud}" cycle="${s.cycle}" menu=${s.menuSize} selected="${s.selected}" calls=${s.calls}`);
      return s;
    };
    /** Wait for the damped easing to finish on the page's own clock. */
    const settle = async (want) => {
      for (let i = 0; i < 140; i++) {
        const v = JSON.parse(await evalJs('JSON.stringify(window.__v12.viewState())'));
        // The easing is exponential (fraction += (goal-fraction)*k, SPEC.view.damping
        // 9/s): a goal of 1 is approached, never snapped. Reading the hoist at
        // fraction 0.9995 measured 34.23 against the published 34.25 - the gate was
        // sampling a view that was still travelling. 1e-6 is the view's own residual.
        const done = want === 'apart' ? 1 - v.fraction < 1e-6 && v.moved > 0 : v.fraction === 0 && v.moved === 0;
        if (done) return v;
        await sleep(100);
      }
      throw new Error(`the ${want === 'apart' ? 'separation' : 'collapse'} did not settle to 1e-6 within 14 s`);
    };
    /** Let the page run N real animation frames: the loop repaints the crank poses
     * and the HUD on its own clock, so a measurement taken between frames is not a
     * measurement of what the user sees. */
    const breathe = async (frames = 40) => {
      const from = await evalJs('window.__v12.frameCount()');
      for (let i = 0; i < 60; i++) {
        await sleep(150);
        if ((await evalJs('window.__v12.frameCount()')) - from >= frames) return;
      }
      throw new Error(`the page produced fewer than ${frames} animation frames in 9 s`);
    };

    const version = await evalJs('window.__v12.version');

    // ---- the panel is there, and its limits are the simulation's own limits ----
    const published = await evalJs("import('/src/engine/animation.js').then((m) => [m.RPM_MIN, m.RPM_MAX])");
    const panelIds = JSON.parse(
      await evalJs(
        `JSON.stringify(['btn-run','btn-reset','rpm','rpm-out','slowmo','btn-cut','btn-explode','btn-assemble','part-select','btn-inspect','btn-clear'].map((id) => !!document.getElementById(id)))`
      )
    );
    const start = await snap('0 boot');
    if (!panelIds.every(Boolean)) bad.push(`panel controls missing: ${JSON.stringify(panelIds)}`);
    if (start.rpmMin !== String(published[0]) || start.rpmMax !== String(published[1]))
      bad.push(`slider bounds ${start.rpmMin}..${start.rpmMax} are not the published RPM limits ${published.join('..')}`);
    // The menu is generated from the scene, so the law is the two counts agreeing -
    // never a number this file remembers (it was 133 for the V8, and a rebuilt
    // engine would only have made the gate lie about the scene).
    const publishedParts = await evalJs('window.__v12.inspectables().length');
    if (start.menuSize !== publishedParts)
      bad.push(`PART INSPECTION menu holds ${start.menuSize} entries, the scene publishes ${publishedParts} inspectable members`);
    if (publishedParts < 60) bad.push(`the scene publishes only ${publishedParts} inspectable members`);
    if (start.outlines !== 0) bad.push('the scene starts with a selection outline in it');

    // ---- START / STOP ---------------------------------------------------------
    await clickControl('#btn-run');
    const stopped = await snap('1 STOP clicked');
    if (stopped.running !== false) bad.push('STOP click did not stop the engine');
    if (stopped.runLabel !== 'START' || stopped.runPressed !== 'false')
      bad.push(`the run button says "${stopped.runLabel}" aria-pressed=${stopped.runPressed} while the engine is stopped`);
    if (!stopped.hud.includes('engine stopped')) bad.push(`status line after STOP: "${stopped.hud}"`);
    // A box measured on a running engine is a box at one crank angle: pistons and
    // valves travel, so the reference for "nothing left floating apart" has to be
    // taken while the clock is stopped, and compared against the same angle again.
    const refGeom = await snap('1b geometry reference, engine stopped');
    if (refGeom.running !== false) bad.push('the geometry reference was taken while the engine was running');
    await clickControl('#btn-run');
    const running = await snap('2 START clicked');
    if (running.running !== true) bad.push('START click did not start the engine');
    if (running.runLabel !== 'STOP' || running.runPressed !== 'true')
      bad.push(`the run button says "${running.runLabel}" aria-pressed=${running.runPressed} while the engine runs`);
    if (!running.hud.includes('rpm')) bad.push(`status line after START: "${running.hud}"`);

    // ---- RPM CONTROL: real arrow keys on the real slider --------------------
    const slider = await rectOf('#rpm');
    await clickAt(slider.x, slider.y);
    const centred = await snap('3 click at the centre of the slider');
    const mid = (published[0] + published[1]) / 2;
    if (centred.stateRpm !== mid)
      bad.push(`a click at the centre of the RPM slider left it at ${centred.stateRpm}, the centre of ${published[0]}..${published[1]} is ${mid}`);
    const beforeRpm = centred.stateRpm;
    for (let i = 0; i < 4; i++) await pressKey('ArrowRight');
    const up = await snap('4 four ArrowRight');
    if (up.stateRpm !== beforeRpm + 100) bad.push(`four ArrowRight presses moved rpm ${beforeRpm} -> ${up.stateRpm} (expected +100 at the published step)`);
    if (up.rpmOut !== `${up.stateRpm} rpm`) bad.push(`the rpm readout says "${up.rpmOut}" while the simulation is at ${up.stateRpm}`);
    await pressKey('End');
    const atMax = await snap('5 End key at the ceiling');
    if (atMax.stateRpm !== published[1]) bad.push(`End key left rpm at ${atMax.stateRpm}, the published ceiling is ${published[1]}`);
    await pressKey('Home');
    const atMin = await snap('6 Home key at zero');
    if (atMin.stateRpm !== published[0]) bad.push(`Home key left rpm at ${atMin.stateRpm}, the published floor is ${published[0]}`);
    if (atMin.running !== true) bad.push('running the slider stopped the engine');
    // the clamp is the authority: whatever the code sets, the panel shows that
    await evalJs('window.__v12.setRpm(99999); "ok"');
    await sleep(200);
    const clamped = await snap('7 setRpm(99999) clamped');
    if (clamped.stateRpm !== published[1] || clamped.rpm !== published[1])
      bad.push(`setRpm(99999): state ${clamped.stateRpm}, slider shows ${clamped.rpm} - the panel must echo the clamp`);
    await evalJs('window.__v12.setRpm(1800); "ok"');
    await sleep(200);

    // ---- movement keys must not fire out of a form field --------------------
    const beforeLeak = (await snap('8 before the WASD leak test')).pose;
    await pressKey('w');
    await holdKey('w', 700);
    const leaked = await snap('9 W held while the slider has focus');
    if (leaked.active !== 'rpm') bad.push(`the slider lost focus during the keyboard test (activeElement=${leaked.active})`);
    if (JSON.stringify(leaked.pose.eye) !== JSON.stringify(beforeLeak.eye))
      bad.push(`a movement key walked the camera out of a focused slider: ${beforeLeak.eye} -> ${leaked.pose.eye}`);

    // ---- WASD walking and orbit/zoom on the canvas --------------------------
    await clickAt(90, Math.round(vp.h * 0.9)); // a click on empty cell space takes focus off the panel
    const sky = await snap('10 focus off the panel');
    if (sky.active === 'rpm' || sky.active === 'slowmo' || sky.active === 'part-select')
      bad.push(`focus never left the panel control (${sky.active}), so WASD cannot work`);
    const beforeWalk = sky.pose;
    await holdKey('w', 700);
    const walked = await snap('11 W held on the canvas');
    if (JSON.stringify(walked.pose.eye) === JSON.stringify(beforeWalk.eye))
      bad.push('holding W did not walk the camera: WASD walking is not functional');
    if (Math.abs(walked.pose.dist - beforeWalk.dist) > 1e-2)
      bad.push(`walking changed the orbit range (${beforeWalk.dist} -> ${walked.pose.dist}): a walk must translate, not orbit`);

    const cx = Math.round(vp.w / 2);
    const cy = Math.round(vp.h * 0.85);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx - 120, y: cy, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx - 120 + i * 22, y: cy - i * 6, button: 'left', buttons: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 56, y: cy - 48, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(900);
    const orbited = await snap('12 press and drag orbit');
    if (orbited.pose.az === walked.pose.az && orbited.pose.el === walked.pose.el)
      bad.push('a press-and-drag on the canvas did not orbit the camera');
    if (orbited.view.inspected !== walked.view.inspected)
      bad.push(`an orbit was mistaken for a part selection (${walked.view.inspected} -> ${orbited.view.inspected})`);

    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -400 });
    await sleep(900);
    const zoomed = await snap('13 wheel zoom');
    if (!(zoomed.pose.dist < walked.pose.dist)) bad.push(`wheel did not zoom in smoothly: range ${walked.pose.dist} -> ${zoomed.pose.dist}`);

    // ---- RESET CAMERA --------------------------------------------------------
    await clickControl('#btn-reset');
    const reset = await snap('14 RESET CAMERA clicked');
    // rig.home is a THREE pose (target is a Vector3), so it is normalised here rather
    // than assumed to be plain numbers
    const home = JSON.parse(
      await evalJs(
        `JSON.stringify((() => { const h = window.__v12.rig.home; const t = h.target.toArray ? h.target.toArray() : h.target; return { az: +h.az.toFixed(4), el: +h.el.toFixed(4), dist: +h.dist.toFixed(2), target: t.map((n) => +n.toFixed(2)) }; })())`
      )
    );
    await sleep(1400);
    const settledHome = await snap('14b home pose reached');
    let dAz = Math.abs(((settledHome.pose.az - home.az + Math.PI) % (2 * Math.PI)) - Math.PI);
    if (dAz > 2e-3) bad.push(`RESET CAMERA left azimuth ${settledHome.pose.az}, the published home azimuth is ${home.az}`);
    if (Math.abs(settledHome.pose.dist - home.dist) > 0.5)
      bad.push(`RESET CAMERA left range ${settledHome.pose.dist}, the published home range is ${home.dist}`);
    if (JSON.stringify(settledHome.pose.focus) !== JSON.stringify(home.target))
      bad.push(`RESET CAMERA left focus ${settledHome.pose.focus}, the published home target is ${home.target}`);
    void reset; void dAz;

    // ---- SLOW MOTION: real arrow keys on the real select --------------------
    // The status line has two writers on purpose: a control writes a confirmation the
    // moment it is used, and the animation loop repaints the canonical readout every
    // 30 frames. Which one is on screen when the gate looks is a race, so a wording
    // match here is a flaky law: "slow motion 0.25" and "1800 rpm - crank 515deg -
    // slowmo 0.25" are the same fact in the app's own two vocabularies. The law below
    // is therefore read several times and measured against the factor the state
    // module actually holds - every read must be a legitimate statement of it.
    const statusReads = async () =>
      JSON.parse(
        await evalJs(`(async () => {
          const out = [];
          for (let i = 0; i < 8; i++) {
            out.push({ line: document.getElementById('status').textContent, factor: window.__v12.state.slowmo, rpm: window.__v12.state.rpm });
            await new Promise((res) => setTimeout(res, 190));
          }
          return JSON.stringify(out);
        })()`),
      );
    // The status line has two writers on purpose: a control writes a confirmation the
    // moment it is used, and the loop writes the canonical readout that names the live
    // state. Which of the two happens to be on screen when the gate looks is a race, and
    // that race is exactly what let a lying confirmation pass, and the four records show
    // it happening: the same P07-slowmo-confirmation poke read RED with 2 findings in
    // tmp/mutate-panel-previous.out:22, then a surprise with findings=0 in
    // tmp/mutate-panel-record1.out:22, then a surprise with findings=1 in
    // tmp/mutate-panel-record2.out:22, then RED with 5 findings in tmp/mutate-panel.out:22.
    // The two surprises are the hole: src/main.js had by then bounded a confirmation to
    // STATUS_HOLD_MS, and a law that samples the line at a moment it guessed cannot see a
    // message that is deliberately short-lived.
    // So the gate does not sample it: a MutationObserver records every change the line
    // really made, and the confirmation laws are read off that record.
    // The hold src/main.js gives a confirmation is STATUS_HOLD_MS = 500 ms, and it can
    // only expire at a frame boundary, because the canonical readout is a per-frame HUD
    // line written inside the loop in src/main.js: the line is handed back at the first
    // animation frame at or after the hold. So a takeover is 500 ms plus the time the
    // page needs to reach that frame, and only the first term belongs to the product.
    // Two fixed constants were measured wrong by exactly that, and both stay named:
    //   a 3000 ms wall ceiling: tmp/g6-run14.out:88 failed 18a at 4277 ms on a host
    //     rasterising near 1 fps, which is about three frame gaps and something the
    //     engine code cannot shorten;
    //   CONFIRM_MAX_FRAMES = 4: it aborted the negative-control driver's own baseline
    //     (tmp/mutate-panel-record3.out:2), and the findings that aborted it read 32
    //     animation frames for the two slow-motion windows (tmp/mutate-panel-record3.out
    //     :21 and :22) on a host near 60 fps. The same shape on that same host is printed
    //     green in tmp/g6-run16.out:37 and :44, 32 frames across 512 ms and 508 ms: the
    //     same 500 ms hold, kept correctly, only counted in the wrong unit.
    // Neither a fixed millisecond count nor a fixed frame count is host-rate independent.
    // The ceiling has to be the declared hold expressed in the cadence the page itself
    // had while the window was open, so armConfirm also installs a probe on the page's
    // own rAF clock and confirmLaw reads the frame period three ways inside the window
    // it judges - the probe's slowest period, its mean period, and the counter interval
    // the confirmation record itself spans - and the bound is the declared hold plus a
    // declared number of the slowest reading that was actually delivered. Taking the
    // slowest is what keeps a ceiling honest when the two readings disagree: the 18a
    // window in tmp/g6-record4-baseline.out:47 counted 529 ms across 3 frames, a 176.3 ms
    // counter interval, while the page's rAF probe in the same window reported 3 periods
    // whose slowest was 498 ms - the section build stalled the loop, and a ceiling built
    // on 176 ms would have called correct behaviour a violation. That file is the
    // pre-poke baseline of the record in tmp/mutate-panel.out, output-sha256=
    // 2864157f3c0e75ea2f6ea9e2f8fd9740381eea0d66cef3923673cb22816fbe81, copied out of the
    // scratch file tmp/g6-baseline.out that every driver run overwrites, so the
    // measurement stays citable. HARNESS TRAP, recorded: the counter is not a pure
    // loop-frame measure, because grabFrame() (src/main.js:261) renders, reads the whole
    // drawing buffer back and increments the same counter, and snap() calls it - so the
    // gate's own pixel proof blocks the page it is measuring, inside the window being
    // judged. That is why the cadence is measured from the page and never assumed. What
    // the law fixes is the product's window; what it divides out is the host's rate.
    // tmp/slowmo-confirm-probe.out measured the takeover at 1273 ms (1x) and 1288 ms
    // (0.02x) on a near-1 fps host, which is what made the frame-period term necessary.
    const STATUS_HOLD_MS = 500; // the window src/main.js:119 declares; measured below
    const STATUS_HOLD_GAPS = 2; // of the page's own frame gaps may cover the expiry
    const STATUS_HOLD_TEXT = '500 ms and one animation frame';
    const backIndex = (seen, CANON) => {
      for (let j = 1; j < seen.length; j++) if (CANON.test(seen[j].text) && !CANON.test(seen[j - 1].text)) return j - 1;
      return -1;
    };
    const armConfirm = async () =>
      await evalJs(`(() => {
        const el = document.getElementById('status');
        if (window.__conf && window.__conf.obs) window.__conf.obs.disconnect();
        const rec = () => {
          const c = window.__conf;
          const text = el.textContent;
          const last = c.seen[c.seen.length - 1];
          if (!last || last.text !== text)
            c.seen.push({ ms: Math.round(performance.now() - c.at), text: text, frame: window.__v12.frameCount() });
        };
        const self = { at: performance.now(), seen: [], cad: [{ ms: 0, frame: window.__v12.frameCount() }] };
        self.obs = new MutationObserver(rec);
        window.__conf = self;
        self.obs.observe(el, { characterData: true, childList: true, subtree: true });
        rec();
        // Cadence probe: one sample per animation frame, on the page's own rAF clock -
        // the same clock src/main.js:247 drives its loop with, so the delta between two
        // samples is one animation period of this host at this moment. It stops the
        // moment its own window is closed or superseded.
        const probe = () => {
          if (window.__conf !== self || !self.obs) return;
          self.cad.push({ ms: Math.round(performance.now() - self.at), frame: window.__v12.frameCount() });
          if (self.cad.length < 6000) requestAnimationFrame(probe);
        };
        requestAnimationFrame(probe);
        return self.seen.length;
      })()`);
    const confirmLaw = async (tag, want) => {
      const rec = JSON.parse(await evalJs(`(async () => {
        const c = window.__conf;
        if (!c) return JSON.stringify({ seen: [], canonicalAtMs: null, unarmed: true });
        const CANON = /crank [0-9]+/;
        // Summarise the probe inside the window being judged: every animation period the
        // page actually took, its slowest one, and how many frames it counted.
        const cadenceOf = (arr) => {
          const gaps = [];
          for (let i = 1; i < arr.length; i++) {
            const dt = arr[i].ms - arr[i - 1].ms;
            if (dt > 0) gaps.push(dt);
          }
          const span = arr.length > 1 ? arr[arr.length - 1].ms - arr[0].ms : 0;
          return {
            samples: arr.length,
            gaps: gaps.length,
            maxGapMs: gaps.length ? Math.max(...gaps) : null,
            meanGapMs: gaps.length ? Math.round((span / gaps.length) * 10) / 10 : null,
            spanMs: span,
            frames: arr.length > 1 ? arr[arr.length - 1].frame - arr[0].frame : 0,
          };
        };
        for (let i = 0; i < 1000; i++) {
          const s = c.seen;
          for (let j = 1; j < s.length; j++) {
            if (CANON.test(s[j].text) && !CANON.test(s[j - 1].text)) {
              if (c.obs) c.obs.disconnect();
              // The record outlives the takeover by up to one poll interval, because the
              // gate notices the change by asking the page, not by being told: the samples
              // after that would belong to the next measurement, not to this window. So
              // the window is cut at the takeover plus two poll allowances (2 x 60 ms),
              // which is wide enough that rounding cannot drop the frame the canonical
              // write happened in and narrow enough to exclude the gate's own follow-up
              // work. HARNESS TRAP, recorded: snap() calls grabFrame() (src/main.js:261),
              // which renders, reads the whole drawing buffer back and increments the
              // same frame counter - it blocks the page's main thread for as long as the
              // readout takes, and that stall is inside the window being judged here. It
              // is why the cadence is measured from the page instead of assumed.
              const cut = s[j].ms + 120;
              return JSON.stringify({
                seen: s,
                confirmationAtMs: s[j - 1].ms,
                canonicalAtMs: s[j].ms,
                cadence: cadenceOf(c.cad.filter((x) => x.ms <= cut)),
                cadenceWholeRecord: cadenceOf(c.cad),
              });
            }
          }
          await new Promise((r) => setTimeout(r, 60));
        }
        if (c.obs) c.obs.disconnect();
        return JSON.stringify({ seen: c.seen, canonicalAtMs: null, cadence: cadenceOf(c.cad) });
      })()`));
      const CANON = /crank [0-9]+/;
      const lines = rec.seen.map((x) => x.text);
      if (rec.unarmed) bad.push(`${tag}: the gate armed no confirmation record before the control was used`);
      // slice(1) drops whatever the line was carrying when the record was armed; only
      // changes made after the arm can belong to the control being tested.
      const confs = (rec.seen ?? []).slice(1).filter((x) => !CANON.test(x.text));
      if (confs.length === 0)
        bad.push(`${tag}: the control wrote no confirmation at all - the line went ${JSON.stringify(lines)}`);
      else if (!confs.some((x) => want.test(x.text)))
        bad.push(`${tag}: the confirmation was ${JSON.stringify(confs.map((x) => x.text))} - it does not state ${String(want)}`);
      if (rec.canonicalAtMs === null)
        bad.push(`${tag}: the canonical readout never took the status line back within 60 s (${JSON.stringify(lines)}) - a confirmation may not own the line indefinitely`);
      else {
        const back = rec.seen.find((x, i) => i > 0 && CANON.test(x.text) && !CANON.test(rec.seen[i - 1].text));
        const held = (rec.seen[backIndex(rec.seen, CANON)] ?? {}).frame;
        const frames = back ? back.frame - held : null;
        const heldMs = rec.canonicalAtMs - rec.confirmationAtMs;
        // The animation cadence of this host, read three ways inside this very window:
        // the slowest period the page's own rAF probe measured, the mean period the same
        // probe measured, and the counter interval the confirmation record itself spans
        // (its frame counter moved while the line was owned, so this is cadence too).
        // The law uses the slowest of the readings that were actually delivered, so an
        // uneven cadence or a starved probe cannot make the ceiling artificially tight.
        const cad = rec.cadence ?? {};
        const readings = [cad.maxGapMs, cad.meanGapMs, frames > 0 ? Math.round((heldMs / frames) * 10) / 10 : null].filter((x) => typeof x === 'number' && x > 0);
        const gap = readings.length ? Math.max(...readings) : null;
        const ceilingMs = gap === null ? null : STATUS_HOLD_MS + STATUS_HOLD_GAPS * gap;
        console.log(
          `${tag}: confirmation "${(confs[0] ?? {}).text}" at +${rec.confirmationAtMs} ms (frame ${held}), ` +
            `canonical "${back.text}" at +${rec.canonicalAtMs} ms (frame ${back.frame}) - held for ${frames} ` +
            `animation frames and ${heldMs} ms; cadence read three ways in this window: rAF probe ` +
            `${cad.samples} samples / ${cad.gaps} periods, slowest ${cad.maxGapMs ?? 'n/a'} ms, mean ${cad.meanGapMs ?? 'n/a'} ms; ` +
            `counter interval ${frames > 0 ? Math.round((heldMs / frames) * 10) / 10 : 'n/a'} ms; slowest reading ` +
            `${gap === null ? 'unmeasured' : `${gap} ms`} -> ceiling ${ceilingMs === null ? 'n/a' : `${Math.round(ceilingMs)} ms`}; ` +
            `window cut ${cad.samples} probe samples, whole record ${rec.cadenceWholeRecord?.samples ?? 0}`,
        );
        if (gap === null)
          bad.push(`${tag}: the page delivered ${cad.samples ?? 0} animation-frame samples across ${cad.spanMs ?? 0} ms of this window and its record counted ${frames} frames, so no frame period could be measured at all - a takeover cannot be bounded against a cadence that was never delivered`);
        else {
          if (heldMs > ceilingMs)
            bad.push(`${tag}: the confirmation owned the status line for ${heldMs} ms across ${frames} animation frames - the hold is ${STATUS_HOLD_TEXT}, which on this host is ${STATUS_HOLD_MS} ms + ${STATUS_HOLD_GAPS} frame periods (the slowest cadence measured in this window: ${gap} ms) = ${Math.round(ceilingMs)} ms; the readout is not bounded by a window the product controls`);
          if (heldMs < STATUS_HOLD_MS - gap)
            bad.push(`${tag}: the canonical readout took the line back ${heldMs} ms after the confirmation, before its ${STATUS_HOLD_TEXT} hold had expired at this cadence (frame period ${gap} ms) - a confirmation the user has no time to read is no confirmation`);
        }
      }
      return rec;
    };
    // The words each control owes the user, from the control's own module: 1x is real
    // time, not "slow motion 1".
    const slowmoWords = (f) =>
      f < 1 ? new RegExp('^slow motion ' + String(f).split('.').join('\\.') + '$') : /^slow motion off - real time$/;
    const namesFactor = (line, f) =>
      new RegExp('slow\\s*(mo|motion)?\\s*' + String(f).split('.').join('\\.') + '(?![0-9.])').test(String(line ?? ''));
    const slowmoLaw = async (tag, first) => {
      const authority = first.stateSlowmo;
      const reads = [{ line: first.hud, factor: authority }, ...(await statusReads())];
      for (const r of reads) {
        if (r.factor !== authority)
          bad.push(`slow motion ${tag}: the factor moved while it was being read (${authority} -> ${r.factor})`);
        if (authority < 1 && !namesFactor(r.line, authority))
          bad.push(`status line ${tag}: "${r.line}" does not name the slow-motion factor ${authority} the state module holds`);
        if (authority === 1 && namesFactor(r.line, 1))
          bad.push(`status line ${tag}: "${r.line}" - 1x is not a slow motion, it is real time`);
      }
      if (first.running && !reads.some((r) => /\brpm\b/.test(String(r.line ?? ''))))
        bad.push(`status line ${tag}: no read names the engine speed (${JSON.stringify(reads.map((r) => r.line))})`);
    };

    const slowFocused = await focusById('slowmo');
    if (!slowFocused) bad.push('SLOW MOTION could not be reached by Tab: the panel is not keyboard operable');
    await armConfirm();
    await pressKey('ArrowDown');
    const slow1 = await snap('15 slow motion one step');
    if (!(slow1.stateSlowmo < 1)) bad.push(`slow motion select did not change the factor (${slow1.stateSlowmo})`);
    await slowmoLaw('after one ArrowDown on the slow-motion select', slow1);
    const confSlow1 = await confirmLaw('15a the confirmation SLOW MOTION wrote for factor ' + slow1.stateSlowmo, slowmoWords(slow1.stateSlowmo));
    if (!slow1.slowmoLabel.includes(String(slow1.stateSlowmo)))
      bad.push(`the slow-motion option says "${slow1.slowmoLabel}" while the simulation is at ${slow1.stateSlowmo}`);
    await pressKey('ArrowDown');
    const slow2 = await snap('16 slow motion two steps');
    if (!(slow2.stateSlowmo <= slow1.stateSlowmo)) bad.push(`slow motion went the wrong way: ${slow1.stateSlowmo} -> ${slow2.stateSlowmo}`);
    // The vocabulary is four options (1, 1/4, 1/10, 1/50), so two ArrowDown from
    // real time land on 0.1 and the way back is two ArrowUp presses. What is
    // asserted is the direction and the round trip, never a step count.
    await pressKey('ArrowUp');
    const slowUp1 = await snap('17 slow motion one step back');
    if (!(slowUp1.stateSlowmo > slow2.stateSlowmo))
      bad.push(`ArrowUp did not move slow motion toward real time: ${slow2.stateSlowmo} -> ${slowUp1.stateSlowmo}`);
    await armConfirm();
    await pressKey('ArrowUp');
    const slowBack = await snap('17b slow motion back to 1x');
    if (slowBack.stateSlowmo !== 1)
      bad.push(`the slow-motion round trip did not return to real time: ${slow2.stateSlowmo} -> ${slowUp1.stateSlowmo} -> ${slowBack.stateSlowmo}`);
    await slowmoLaw('after returning to real time', slowBack);
    const confReal = await confirmLaw('17c the confirmation SLOW MOTION wrote for real time', slowmoWords(slowBack.stateSlowmo));

    // ---- CUTAWAY ------------------------------------------------------------
    await armConfirm();
    await clickControl('#btn-cut');
    const cutOn = await snap('18 CUTAWAY clicked');
    if (cutOn.view.cutaway !== true) bad.push('CUTAWAY click did not open the section');
    if (cutOn.cutPressed !== 'true') bad.push(`the cutaway button aria-pressed=${cutOn.cutPressed} while the section is open`);
    const confCut = await confirmLaw('18a the confirmation CUTAWAY wrote', /cutaway on - one plane through the crank axis/);
    const cutFacts = JSON.parse(
      await evalJs(`JSON.stringify((() => {
        const v = window.__v12, THREE = v.THREE;
        const mats = (o) => (Array.isArray(o.material) ? o.material : [o.material]);
        const clipped = (root) => {
          let n = 0;
          root.traverse((o) => {
            if (!o.isMesh) return;
            for (const m of mats(o)) {
              if (m && Array.isArray(m.clippingPlanes) && m.clippingPlanes.length > 0) n += 1;
            }
          });
          return n;
        };
        const c = v.viewState().cutawayPlane;
        const eng = clipped(v.engine);
        const stand = clipped(v.stand.group);
        if (!c) return { eng, stand, normal: null, constant: null, axis: null };
        const plane = new THREE.Plane(new THREE.Vector3(c.normal[0], c.normal[1], c.normal[2]), c.constant);
        const axis = [];
        for (const x of [-24, 0, 24]) {
          axis.push(+Math.abs(plane.distanceToPoint(new THREE.Vector3(x, 0, 0))).toFixed(6));
        }
        return { eng, stand, normal: c.normal, constant: c.constant, axis };
      })())`)
    );
    if (cutFacts.eng === 0) bad.push('CUTAWAY click clipped nothing in the engine');
    if (cutFacts.stand !== 0)
      bad.push(`CUTAWAY clipped ${cutFacts.stand} test-stand materials: the section must be private to the engine`);
    if (!cutFacts.normal) bad.push('CUTAWAY is open but the view publishes no section plane');
    if (cutFacts.normal && Math.abs(cutFacts.normal[0]) > 1e-9)
      bad.push(`the section normal ${JSON.stringify(cutFacts.normal)} has an X term: the cut must be one plane through the crank axis`);
    if (!(cutFacts.axis && cutFacts.axis.length === 3 && cutFacts.axis.every((d) => d < 1e-6)))
      bad.push(`the section plane misses the crank axis: ${JSON.stringify(cutFacts.axis)}`);
    if (!cutOn.hud.includes('cutaway')) bad.push(`status line after CUTAWAY: "${cutOn.hud}"`);

    // ---- EXPLODED VIEW (with the cutaway open: the view must close it) ------
    await clickControl('#btn-explode');
    const apartState = await settle('apart');
    const apart = await snap('19 EXPLODED VIEW clicked');
    // How many members SHOULD move is not a number this file remembers: it is the
    // members the published teardown table claims. Counting them here, out of the
    // same rule set the view applies, keeps the law true for any engine build (it
    // was 107 for the V8, 149 for the V12).
    const ruleCount = await evalJs(`(async () => {
      const { explodeRuleFor } = await import('/src/engine/view.js');
      let n = 0;
      for (const name of window.__v12.view.members.keys()) if (explodeRuleFor(name)) n += 1;
      return n;
    })()`);
    if (!(apartState.fraction > 0.999 && apartState.moved === ruleCount))
      bad.push(`exploded view settled at ${JSON.stringify(apartState)}, the table claims ${ruleCount} members`);
    if (apart.view.cutaway !== false || apart.cutPressed !== 'false')
      bad.push(`EXPLODED VIEW left the cutaway open (cutaway=${apart.view.cutaway} aria-pressed=${apart.cutPressed})`);
    if (apart.explodePressed !== 'true' || apart.assemblePressed !== 'false')
      bad.push(`view buttons disagree with the state: exploded aria-pressed=${apart.explodePressed} assembled aria-pressed=${apart.assemblePressed}`);
    // The hoist is not a constant to remember either (34.25 was what the V8 earned):
    // the law behind it is that nothing in the separated assembly may sink through
    // the test-cell floor plate, which is what the published lift exists to prevent.
    const floorLaw = await evalJs(`(async () => {
      const { SPEC } = await import('/src/engine/spec.js');
      const { explodeSpecs } = await import('/src/engine/view.js');
      const v = window.__v12;
      const b = new v.THREE.Box3().setFromObject(v.engine);
      return { minZ: +b.min.z.toFixed(3), limit: SPEC.stand.floorZ + explodeSpecs().floorMargin, engineZ: v.viewState().engineZ };
    })()`);
    if (!(floorLaw.minZ >= floorLaw.limit - 1e-2 && floorLaw.engineZ > 0))
      bad.push(`the separated assembly sinks to z ${floorLaw.minZ}, the floor law allows nothing below ${floorLaw.limit} (hoist ${floorLaw.engineZ})`);
    const apartBox = apart.live;

    // ---- PART INSPECTION from the panel menu ---------------------------------
    const menuFocused = await focusById('part-select');
    if (!menuFocused) bad.push('PART INSPECTION menu could not be reached by Tab: the panel is not keyboard operable');
    await pressKey('ArrowDown');
    await pressKey('ArrowDown');
    const chosen = await snap('20 menu moved two entries');
    if (chosen.selected === apart.selected) bad.push('arrow keys on the PART INSPECTION menu changed nothing');
    await clickControl('#btn-inspect');
    const insp = await snap('21 INSPECT clicked');
    // No second inspect() call here on purpose: framing a moving part again would
    // publish a different range and the comparison below would compare the camera
    // against a framing the gate itself caused. view.state().frameRange is the range
    // the panel's own click commanded.
    if (insp.view.inspected !== chosen.selected) bad.push(`INSPECT selected ${insp.view.inspected}, the menu said ${chosen.selected}`);
    if (insp.outlines !== 1) bad.push(`PART INSPECTION put ${insp.outlines} outlines in the scene (expected 1)`);
    if (insp.inspectPressed !== 'true') bad.push(`the INSPECT button aria-pressed=${insp.inspectPressed} while a part is selected`);
    if (!(insp.view.frameRange > 0)) bad.push(`PART INSPECTION published no framing range (${insp.view.frameRange})`);
    else if (Math.abs(insp.pose.dist - insp.view.frameRange) > 1e-2)
      bad.push(`the camera stands at ${insp.pose.dist} cm, PART INSPECTION published a framing range of ${insp.view.frameRange} cm`);
    if (!insp.hud.includes('inspecting')) bad.push(`status line after INSPECT: "${insp.hud}"`);
    const cycleLive = (line) => {
      const m = /^CYL 1 (POWER|EXHAUST|INTAKE|COMPRESSION)\s+(\d+)° of 720°$/.exec(line ?? '');
      if (!m) bad.push(`the cycle readout is not a stroke name with a crank angle: "${line}"`);
      else if (!(Number(m[2]) >= 0 && Number(m[2]) <= 720))
        bad.push(`the cycle readout "${line}" names an angle outside the 720° four-stroke cycle`);
      return m;
    };
    cycleLive(insp.cycle);

    // ---- the cycle readout names the crank angle it is drawn from, LIVE -------
    // At 1800 rpm the crank travels 180 degrees per frame: every frame crosses a
    // stroke boundary, so a readout that repaints only on a stroke NAME still looks
    // live at that rpm. The law is therefore measured where a frame is an order of
    // magnitude smaller than a stroke: 250 rpm at 1/50 slow motion is 250*6*0.02 =
    // 30 crank degrees per second, about 0.5 degrees per 60 fps frame.
    // Each sample reads the DOM line and state.theta inside ONE synchronous
    // page-side call: the panel wrote that line from that theta during the frame
    // that just ended, and no frame can fire between the two reads, so the two
    // numbers are the same number or the readout is stale.
    // The block below borrows the clock at a different rpm and slowmo setting, so it
    // has to hand back the run state it found: the steps after it read the panel,
    // and a control cycle that started somewhere else is a control cycle nobody ran.
    const foundState = await evalJs(`(async () => {
      const v = window.__v12;
      return { rpm: v.state.rpm, slowmo: v.state.slowmo, running: v.state.running };
    })()`);
    await evalJs(`window.__v12.setRpm(250); window.__v12.setSlowmo(0.02); window.__v12.start(); "ok"`);
    await sleep(200);
    let liveSeen = [];
    for (let i = 0; i < 5; i++) {
      const sm = await evalJs(`(async () => {
        const t = await import('/src/engine/timing.js');
        const sp = await import('/src/engine/spec.js');
        const v = window.__v12;
        const theta = v.state.theta;
        return {
          theta,
          authority: t.strokeOf(sp.SPEC.cylinders[0], theta),
          line: document.getElementById('cycle-out').textContent,
        };
      })()`);
      const m = cycleLive(sm.line);
      liveSeen.push({ theta: sm.theta, line: sm.line });
      if (!m) continue;
      if (m[1] !== sm.authority)
        bad.push(`sample ${i + 1}: the panel says CYL 1 is on ${m[1]} while timing.js says ${sm.authority} at crank ${sm.theta}`);
      if (Number(m[2]) !== Number(sm.theta.toFixed(0)))
        bad.push(`sample ${i + 1}: the readout "${sm.line}" names crank ${m[2]} degrees while the state module is at ${sm.theta} - the degree is not repainting with the crank`);
      await sleep(300);
    }
    const movedAngle = liveSeen.some((z, i) => i > 0 && z.theta !== liveSeen[0].theta);
    if (!movedAngle) bad.push('state.theta did not advance during the live cycle samples: the clock is not running');
    const distinctLines = new Set(liveSeen.map((z) => z.line)).size;
    if (distinctLines < 4)
      bad.push(`the CYL 1 readout only produced ${distinctLines} distinct lines across 5 samples spread over 1.5 s at 250 rpm x 1/50 (${JSON.stringify(liveSeen.map((z) => z.line))}) - it repaints on stroke boundaries, not with the crank`);
    const restore = await evalJs(`(async () => {
      const v = window.__v12;
      v.setRpm(${foundState.rpm});
      v.setSlowmo(${foundState.slowmo});
      if (${foundState.running}) v.start(); else v.stop();
      return { rpm: v.state.rpm, slowmo: v.state.slowmo, running: v.state.running };
    })()`);
    if (restore.running !== foundState.running || restore.rpm !== foundState.rpm || restore.slowmo !== foundState.slowmo)
      bad.push(`the live-cycle measurement could not hand the clock back: ${JSON.stringify(foundState)} -> ${JSON.stringify(restore)}`);

    // ---- ASSEMBLE -----------------------------------------------------------
    await clickControl('#btn-assemble');
    const backState = await settle('together');
    const together = await snap('22 ASSEMBLE clicked');
    if (!(backState.fraction === 0 && backState.moved === 0 && backState.engineZ === 0))
      bad.push(`ASSEMBLE did not collapse the view: ${JSON.stringify(backState)}`);
    if (together.assemblePressed !== 'true' || together.explodePressed !== 'false')
      bad.push(`view buttons disagree after ASSEMBLE: assembled aria-pressed=${together.assemblePressed} exploded aria-pressed=${together.explodePressed}`);
    if (together.view.inspected !== insp.view.inspected)
      bad.push(`ASSEMBLE dropped the inspection the user had (${insp.view.inspected} -> ${together.view.inspected})`);
    if (together.outlines !== 1) bad.push(`the selection outline did not survive the collapse (${together.outlines})`);

    // ---- clicking a part in the 3D view --------------------------------------
    await clickControl('#btn-explode');
    await settle('apart');
    const picked = JSON.parse(
      await evalJs(`JSON.stringify((() => {
        const v = window.__v12, THREE = v.THREE;
        const name = 'cam-R-exhaust';
        const obj = v.view.members.get(name);
        v.inspect(name); // frame it first, the way the panel would
        obj.updateWorldMatrix(true, true);
        const b = new THREE.Box3().setFromObject(obj);
        const c = b.getCenter(new THREE.Vector3());
        const rect = v.renderer.domElement.getBoundingClientRect();
        const n = c.project(v.camera);
        const x = Math.round(rect.left + ((n.x + 1) / 2) * rect.width);
        const y = Math.round(rect.top + ((1 - n.y) / 2) * rect.height);
        return { name, x, y, ndc: [+n.x.toFixed(3), +n.y.toFixed(3)], onScreen: Math.abs(n.x) < 1 && Math.abs(n.y) < 1 };
      })())`)
    );
    if (!picked.onScreen) bad.push(`the part meant to be clicked was off screen: ${JSON.stringify(picked)}`);
    await clickControl('#btn-clear');
    const cleared = await snap('23 CLEAR clicked');
    if (cleared.view.inspected !== null || cleared.outlines !== 0)
      bad.push(`CLEAR left inspected=${cleared.view.inspected} with ${cleared.outlines} outlines in the scene`);
    await clickAt(picked.x, picked.y);
    await sleep(300);
    const clickedPart = await snap('24 clicked a part in the view');
    const menuFollows = clickedPart.selected === clickedPart.view.inspected;
    if (clickedPart.view.inspected === null) bad.push(`a click on ${picked.name} in the 3D view selected nothing (screen ${picked.x},${picked.y})`);
    if (!menuFollows)
      bad.push(`the PART INSPECTION menu says "${clickedPart.selected}" while the click selected "${clickedPart.view.inspected}"`);
    if (clickedPart.outlines !== 1) bad.push(`click-picking put ${clickedPart.outlines} outlines in the scene`);

    // ---- the menu follows an inspection the panel did NOT cause -----------------
    // window.__v12.inspect() writes view state and nothing else: no menu code runs on
    // that path. The PART INSPECTION menu can only name the new member if the panel
    // repaints it out of view.state().inspected, which is what "the panel holds no
    // state of its own" is supposed to mean.
    const commanded = 'rod-cyl4';
    await clickControl('#btn-clear');
    const blankMenu = await snap('24a the menu after CLEAR');
    await evalJs(`window.__v12.inspect(${JSON.stringify(commanded)}); "ok"`);
    await sleep(700); // several frames of panel.sync(), no menu code involved
    const followed = await snap('24b an inspection commanded through the published setter');
    if (followed.view.inspected !== commanded)
      bad.push(`the view is inspecting ${followed.view.inspected}, the published setter was told ${commanded}`);
    if (followed.selected !== commanded)
      bad.push(`the PART INSPECTION menu still says "${followed.selected}" while the view inspects ${commanded}: the panel does not repaint the menu from the authority`);
    if (followed.inspectPressed !== 'true')
      bad.push(`the INSPECT button aria-pressed=${followed.inspectPressed} while the view inspects ${commanded}`);
    void blankMenu;

    // ---- teardown: the view the user built, and nothing left floating apart --
    await clickControl('#btn-assemble');
    await settle('together');
    await clickControl('#btn-clear');
    const held = await snap('25 collapsed, the user keeps his own view');
    // A section the user opened is HIS state, not a side effect of the exploded
    // view: ASSEMBLE must give it back, and EXPLODED VIEW is what closes it.
    if (held.view.cutaway !== true)
      bad.push(`ASSEMBLE threw away the cutaway the user had opened (cutaway=${held.view.cutaway})`);
    if (held.view.fraction !== 0 || held.view.moved !== 0)
      bad.push(`ASSEMBLE left the view separated: ${JSON.stringify(held.view)}`);
    if (held.outlines !== 0) bad.push(`${held.outlines} selection outlines left after CLEAR`);
    if (held.view.inspected !== null) bad.push(`CLEAR left inspected=${held.view.inspected}`);

    await clickControl('#btn-cut'); // the same control that opened it
    const cutClosed = await snap('25b CUTAWAY closed by its own button');
    if (cutClosed.view.cutaway !== false || cutClosed.cutPressed !== 'false')
      bad.push(`CUTAWAY off left cutaway=${cutClosed.view.cutaway} aria-pressed=${cutClosed.cutPressed}`);
    if (cutClosed.view.cutawayPlane !== null) bad.push('the view still publishes a section plane after the cut was closed');

    await clickControl('#btn-reset');
    await sleep(1400);

    // ---- STOP, and the cycle readout against the authority -------------------
    // The gate reads the run state before it presses the run control: what is being
    // asserted is that the control turns the engine off, not that the gate happens to
    // know whether it was on.
    const beforeStop = await snap('26a the run state before the last STOP');
    if (beforeStop.running) {
      await clickControl('#btn-run');
    }
    const halted = await snap('26 STOP works from whatever state the cycle left');
    if (halted.running !== false) bad.push('STOP did not work after the whole control cycle');

    // Stopped, the panel's CYL 1 line and timing.js strokeOf can be compared at the
    // same crank angle with nothing in between them.
    const cross = await evalJs(`(async () => {
      const t = await import('/src/engine/timing.js');
      const sp = await import('/src/engine/spec.js');
      const v = window.__v12;
      const theta = v.state.theta;
      return {
        theta,
        authority: t.strokeOf(sp.SPEC.cylinders[0], theta),
        cycle: document.getElementById('cycle-out').textContent,
        hud: document.getElementById('status').textContent,
      };
    })()`);
    const cm = /^CYL 1 (\w+)\s+(\d+)° of 720°$/.exec(cross.cycle ?? '');
    if (!cm) bad.push(`stopped cycle readout is unreadable: "${cross.cycle}"`);
    else {
      if (cm[1] !== cross.authority)
        bad.push(`the panel says CYL 1 is on ${cm[1]} at crank ${cm[2]}°, timing.js says ${cross.authority} at crank ${cross.theta}`);
      if (Number(cm[2]) !== Number(cross.theta.toFixed(0)))
        bad.push(`the panel names crank ${cm[2]}° while the state module is at ${cross.theta}`);
    }
    if (!cross.hud.includes('engine stopped')) bad.push(`stopped status line: "${cross.hud}"`);
    await sleep(600);
    const frozen = await snap('26b the cycle readout is frozen while stopped');
    if (frozen.cycle !== cross.cycle)
      bad.push(`the cycle readout moved while the engine was stopped: "${cross.cycle}" -> "${frozen.cycle}"`);

    // Past the confirmation window the status line is the canonical readout, and one screen
    // must not name two crank angles: the HUD angle, the CYL 1 angle beside it and the angle
    // the state module actually holds have to be the same number. The G7 cutaway pair showed
    // this broken in the picture - the HUD read "crank 540°" beside "CYL 1 POWER 0° of 720°".
    const hudAngle = /crank (\d+)°/.exec(frozen.hud ?? '');
    const cycleAngle = /(\d+)° of 720°/.exec(frozen.cycle ?? '');
    const heldAngle = Number(cross.theta.toFixed(0));
    if (!hudAngle) bad.push(`after the confirmation window the status line names no crank angle: "${frozen.hud}"`);
    else {
      const named = Number(hudAngle[1]);
      if (named !== heldAngle)
        bad.push(`the status line names crank ${named}° while the state module is holding ${cross.theta}`);
      if (cycleAngle && named !== Number(cycleAngle[1]))
        bad.push(`one screen, two angles: "${frozen.hud}" beside "${frozen.cycle}"`);
    }

    // ---- the geometry reference, at the SAME crank angle ---------------------
    // state.theta is the animation module's own clock field and the module publishes
    // no angle setter, so the gate pins it while the engine is stopped (nothing
    // advances it) and lets the loop repaint the crank poses from it. Pistons and
    // valves travel with the crank: comparing live boxes at two angles measures the
    // kinematics, not the teardown.
    await evalJs(`window.__v12.state.theta = ${refGeom.theta}; "pinned"`);
    await breathe(40);
    const end = await snap('27 the assembly, at the reference crank angle');
    if (Math.abs(end.theta - refGeom.theta) > 1e-9)
      bad.push(`the crank angle was not held for the comparison: ${refGeom.theta} -> ${end.theta}`);
    const endHudAngle = /crank (\d+)°/.exec(end.hud ?? '');
    const endCycleAngle = /(\d+)° of 720°/.exec(end.cycle ?? '');
    const pinned = Number(refGeom.theta.toFixed(0));
    if (!endHudAngle) bad.push(`the status line names no crank angle after the pin: "${end.hud}"`);
    else if (Number(endHudAngle[1]) !== pinned)
      bad.push(`after pinning crank ${refGeom.theta} and running 40 real frames the status line still reads "${end.hud}" - the HUD lagged the authority it is supposed to report`);
    if (endCycleAngle && Number(endCycleAngle[1]) !== pinned)
      bad.push(`after pinning crank ${refGeom.theta} the CYL 1 line reads "${end.cycle}"`);
    if (endHudAngle && endCycleAngle && Number(endHudAngle[1]) !== Number(endCycleAngle[1]))
      bad.push(`one screen, two angles after the pin: "${end.hud}" beside "${end.cycle}"`);
    const near = (a, b, tol, tag) => {
      const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
      if (d > tol) bad.push(`${tag}: ${a.join(',')} vs ${b.join(',')} (delta ${d.toFixed(2)} cm)`);
    };
    near(refGeom.live.min, end.live.min, 1e-2, 'assembled box before the controls vs after');
    near(refGeom.live.max, end.live.max, 1e-2, 'assembled box before the controls vs after (max)');
    if (refGeom.calls !== end.calls)
      bad.push(`draw calls ${refGeom.calls} before the control cycle, ${end.calls} after, at one crank angle and the home pose`);
    if (end.view.cutaway !== false || end.view.fraction !== 0 || end.view.moved !== 0 || end.view.engineZ !== 0)
      bad.push(`the view did not come back to the assembled state: ${JSON.stringify(end.view)}`);
    if (end.outlines !== 0) bad.push(`${end.outlines} selection outlines left in the scene`);
    if (end.view.inspected !== null) bad.push(`the cycle left a part inspected: ${end.view.inspected}`);
    const endClean = JSON.parse(
      await evalJs(`JSON.stringify((() => { const v = window.__v12; let n = 0; const mats = (o) => (Array.isArray(o.material) ? o.material : [o.material]); v.engine.traverse((o) => { if (o.isMesh) for (const m of mats(o)) if (m && (String(m.name).endsWith(':sectioned') || (Array.isArray(m.clippingPlanes) && m.clippingPlanes.length))) n += 1; }); return n; })())`)
    );
    if (endClean !== 0) bad.push(`${endClean} sectioned or clipped materials left on the engine`);
    const orphan = JSON.parse(
      await evalJs(`JSON.stringify((() => { const v = window.__v12; let n = 0; v.engine.traverse((o) => { if (o.parent && String(o.parent.name).startsWith('explode:')) n += 1; }); return n; })())`)
    );
    if (orphan !== 0) bad.push(`${orphan} engine meshes still parented to an explode wrapper after ASSEMBLE`);

    // ---- the controls still work after all of that ---------------------------
    await clickAt(slider.x, slider.y); // focus the slider before keying it
    const focused = await snap('28a the slider has focus again');
    if (focused.active !== 'rpm') bad.push(`the RPM slider could not be focused by clicking it (activeElement=${focused.active})`);
    const beforePress = focused.stateRpm;
    await pressKey('ArrowRight');
    const rpmAfter = await snap('28b ArrowRight steps the rpm from whatever it was');
    if (rpmAfter.stateRpm !== beforePress + 25)
      bad.push(`one ArrowRight moved rpm ${beforePress} -> ${rpmAfter.stateRpm}, the published slider step is 25`);
    if (rpmAfter.running !== false) bad.push('the rpm control started the engine on its own');

    const shotPath = join(ROOT, 'shots', '06-controls-end.png');
    writeFileSync(shotPath, await capture());
    if (apartBox) note(`exploded live box ${apartBox.min.join(',')} .. ${apartBox.max.join(',')}`);
    note(`\nshell ${version} at ${pageUrl}`);
    note(`chromium: ${CHROMIUM}`);
    note(`buffer ${end.buffer} webgl2=${end.webgl2} frames=${end.frames} drawCalls=${end.calls}`);
    note(`menu entries ${start.menuSize}, published rpm ${published.join('..')}, slowmo options read back as ${start.slowmoSel}/${start.stateSlowmo}`);
    note(`screenshot: ${shotPath}`);
    if (warnings.length) note(`warnings: ${warnings.length} (${warnings.slice(0, 3).join(' | ')})`);
    note(`console/CDP errors: ${errors.length}${errors.length ? '\n  ' + errors.join('\n  ') : ''}`);
    if (errors.length) bad.push(`${errors.length} console/CDP error(s)`);

    if (bad.length) {
      console.error(`\nCONTROLS INCOMPLETE:\n  ${bad.join('\n  ')}`);
      process.exitCode = 1;
    } else {
      console.log(
        '\nCONTROLS OK: START/STOP, RPM CONTROL, SLOW MOTION, CUTAWAY, EXPLODED VIEW, ASSEMBLE, ' +
          'PART INSPECTION (menu and click-in-view) and RESET CAMERA all work through the real UI, ' +
          'WASD/orbit/zoom walk the camera, and everything came back to the assembled engine'
      );
    }
  });
} catch (err) {
  fail(err.message);
}

