// The control panel: the only place the DOM and the engine meet.
//
// It owns no state. Every control reads what the published authorities already are
// (`state.rpm`, `state.slowmo`, `state.running`, `view.state()`) and writes through
// their setters, then `sync()` re-reads them and repaints the widgets - so a control
// can never disagree with the simulation, and the gates can drive the real buttons.
// The slider bounds are the animation module's published RPM_MIN / RPM_MAX, not a
// second copy typed into the markup.
import { RPM_MAX, RPM_MIN } from '../engine/animation.js';
import { SPEC } from '../engine/spec.js';
import { strokeOf } from '../engine/timing.js';

/**
 * @param {{state: object, view: object, rig: object, say: (msg:string)=>void,
 *   doc?: Document}} deps
 */
export function createPanel({ state, view, rig, say, doc = document }) {
  const el = (id) => doc.getElementById(id);
  const els = {
    panel: el('panel'),
    run: el('btn-run'),
    reset: el('btn-reset'),
    rpm: el('rpm'),
    rpmOut: el('rpm-out'),
    slowmo: el('slowmo'),
    cut: el('btn-cut'),
    explode: el('btn-explode'),
    assemble: el('btn-assemble'),
    parts: el('part-select'),
    inspect: el('btn-inspect'),
    clearInspect: el('btn-clear'),
    cycle: el('cycle-out'),
  };
  for (const [key, node] of Object.entries(els)) {
    if (!node) throw new Error(`control panel: #${key} is missing from the page`);
  }

  // --- RPM: the published limits are the slider limits -----------------------
  els.rpm.min = String(RPM_MIN);
  els.rpm.max = String(RPM_MAX);
  els.rpm.value = String(state.rpm);
  const rpmReadout = () => {
    els.rpmOut.textContent = `${Number(els.rpm.value)} rpm`;
  };
  els.rpm.addEventListener('input', () => {
    state.setRpm(Number(els.rpm.value));
    els.rpm.value = String(state.rpm); // the clamp is the authority, echo it back
    rpmReadout();
  });

  // --- slow motion: the vocabulary lives in the markup, the limit lives in the
  // state module, so whatever it clamps to is what the control shows next
  const slowmoReadout = () => {
    const opt = els.slowmo.selectedOptions[0];
    if (opt) opt.textContent = `${opt.dataset.name ?? opt.value}x  (${state.slowmo})`;
  };
  els.slowmo.addEventListener('change', () => {
    state.setSlowmo(Number(els.slowmo.value));
    slowmoReadout();
    // 1x is not a slow motion: it is real time, so the confirmation the user reads
    // has to say so. A line reading "slow motion 1" is the widget talking about its
    // own value rather than about the simulation.
    say(state.slowmo < 1 ? `slow motion ${state.slowmo}` : 'slow motion off - real time');
  });

  // --- run / stop -------------------------------------------------------------
  els.run.addEventListener('click', () => {
    if (state.running) {
      state.stop();
      say('engine stopped');
    } else {
      state.start();
      say(`${state.rpm} rpm`);
    }
  });

  // --- the view controls ------------------------------------------------------
  els.cut.addEventListener('click', () => {
    const on = !view.isCutaway();
    view.setCutaway(on);
    say(on ? 'cutaway on - one plane through the crank axis' : 'cutaway off');
  });
  els.explode.addEventListener('click', () => {
    view.explode();
    say('exploded view - the chain separates along each build axis');
  });
  els.assemble.addEventListener('click', () => {
    view.assemble();
    say('assembled - the teardown reverses exactly');
  });

  // --- PART INSPECTION: the menu is the scene's own inspectable members ------
  const menu = view.inspectables();
  const frag = doc.createDocumentFragment();
  for (const p of menu) {
    const opt = doc.createElement('option');
    opt.value = p.name;
    const off = view.offsets.get(p.name);
    opt.textContent = `${p.label}${off ? ` (${off.family})` : ''}`;
    frag.appendChild(opt);
  }
  els.parts.appendChild(frag);
  if (menu.length) els.parts.value = menu[0].name;
  els.inspect.addEventListener('click', () => {
    const fit = view.focusPart(els.parts.value);
    if (!fit) {
      say('that part is not in the scene');
      return;
    }
    say(`inspecting ${fit.label} - frame range ${fit.range} cm, ${fit.meshes} meshes`);
  });
  els.clearInspect.addEventListener('click', () => {
    view.clearInspect();
    say('part inspection cleared');
  });

  els.reset.addEventListener('click', () => {
    rig.reset();
    say('camera reset to the published home pose');
  });

  /** Keep the menu selection in step with a part the user clicked in the view. */
  const selectPart = (name) => {
    if (!els.parts.querySelector(`option[value="${name}"]`)) return false;
    els.parts.value = name;
    return true;
  };

  // --- repaint from the authorities, every frame, without churn --------------
  const last = { run: null, cut: null, sep: null, rpm: null, cycle: null, insp: null };
  const press = (node, on) => {
    node.setAttribute('aria-pressed', on ? 'true' : 'false');
    node.dataset.on = on ? '1' : '0';
  };
  const sync = () => {
    if (last.run !== state.running) {
      last.run = state.running;
      els.run.textContent = state.running ? 'STOP' : 'START';
      press(els.run, state.running);
    }
    const vs = view.state();
    if (last.cut !== vs.cutaway) {
      last.cut = vs.cutaway;
      press(els.cut, vs.cutaway);
    }
    const separated = vs.fraction > 0.001;
    if (last.sep !== separated) {
      last.sep = separated;
      press(els.explode, separated);
      press(els.assemble, !separated);
    }
    if (last.insp !== vs.inspected) {
      last.insp = vs.inspected;
      if (vs.inspected) selectPart(vs.inspected);
      press(els.inspect, !!vs.inspected);
    }
    if (Number(els.rpm.value) !== state.rpm) {
      els.rpm.value = String(state.rpm);
      last.rpm = state.rpm;
      rpmReadout();
    }
    // the four-stroke cycle of cylinder 1, on the same crank angle the renderer
    // is drawing pistons and valves from. The degree is part of what is compared,
    // not just the stroke name: gated on the stroke alone the line sits frozen at
    // whatever angle the last stroke boundary happened to land on while the crank
    // keeps turning.
    const cyl = SPEC.cylinders[0];
    const stroke = strokeOf(cyl, state.theta);
    const cycleLine = `CYL 1 ${stroke.padEnd(11)} ${state.theta.toFixed(0).padStart(3)}° of 720°`;
    if (last.cycle !== cycleLine) {
      last.cycle = cycleLine;
      els.cycle.textContent = cycleLine;
    }
  };
  rpmReadout();
  slowmoReadout();
  sync();

  return { sync, selectPart, els, menu };
}
