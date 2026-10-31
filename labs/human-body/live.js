// Page script. DATA, the kit (iso-kit), G (lathe), TB (tube), makeLive and the model functions are inlined before this.
const LIVE = makeLive({ iso, solidSvg, dotsSvg, lineSvg, cylinder }, G, TB, DATA.P, DATA.liveC);
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const root = svg;
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const $ = (sel) => svg.querySelector(sel);
const parts = {
  heart: $('[data-part="heart"]'),
  bladder: $('[data-part="bladder"]'),
  stomach: $('[data-part="stomach"]'),
  arm: $('[data-part="arm"]'),
  needle: $('[data-part="needle"]'),
  dome: [-1, 1].map((s) => $(`[data-part="dome${s}"]`)),
  bellows: [-1, 1].map((s) => $(`[data-part="bellows${s}"]`)),
};
const items = Array.from(svg.querySelectorAll(".it"));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (v, target, dt, tau) => v + (target - v) * (1 - Math.exp(-dt / tau));
const TL = 360; // digestion and kidneys run 360× faster than life: one second here is six minutes

// ------------------------------------------------------------------ state
const S = {
  target: 0, e: 0, clock: 0,
  beat: 0, breath: 0, lastBreathFrac: 0,
  theta: DATA.liveC.rest, drive: 0, curlAt: -10, nextCurl: 0, curls: 0,
  pulses: [], // { name, at, dur, len }
  meal: null, drink: null, bladder: 180, voidAt: null,
  focus: null, touring: !still.matches, idleAt: 0,
  p: { art: 0, vein: 0, food: 0, stool: 0, urine: 0 },
  lastDelayMs: BODY.nervePath / BODY.nerveSpeed * 1000,
};

// ------------------------------------------------------------------ nerve impulses (shown slowed: real ones cross the body in ≈ 14 ms)
function fire(name, delay = 0, dur = 0.45) {
  const len = DATA.lengths[name];
  if (!len) return;
  S.pulses.push({ name, at: S.clock + delay, dur, len });
}
function curl() {
  if (S.clock - S.curlAt < 1.5) return;
  S.curlAt = S.clock;
  S.curls += 1;
  fire("cord", 0, 0.3);
  fire("arm", 0.3, 0.5);
}

// ------------------------------------------------------------------ geometry writes
function place(el, dz) {
  if (!el) return;
  const [dx, dy] = [DATA.up[0] * dz, DATA.up[1] * dz];
  if (Math.abs(dz) < 1e-3) el.removeAttribute("transform");
  else el.setAttribute("transform", `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
}
const scaleAbout = (el, [cx, cy], s) => el && el.setAttribute("transform", `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${s.toFixed(4)}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`);
let lastApex = null;
function lungsAt(apex) {
  if (lastApex !== null && Math.abs(apex - lastApex) < 0.02) return;
  lastApex = apex;
  const L = DATA.lung;
  [-1, 1].forEach((side, j) => {
    parts.dome[j].innerHTML = LIVE.dome(side, apex);
    parts.bellows[j].innerHTML = LIVE.bellows(side, apex);
  });
}
let lastTheta = null;
function armAt(theta, drive) {
  if (lastTheta !== null && Math.abs(theta - lastTheta) < 0.002 && (drive > 0.02) === lastDrive) return;
  lastTheta = theta;
  lastDrive = drive > 0.02;
  parts.arm.innerHTML = LIVE.arm(theta, drive).svg;
}
let lastDrive = false;
function needleAt(hr) {
  const g = DATA.gauge;
  const a = (hr / 240) * Math.PI * 2;
  parts.needle.setAttribute("d", lineOnTop([g.c[0] - Math.sin(a) * 3.2, g.c[1] + Math.cos(a) * 3.2], [g.c[0] + Math.sin(a) * (g.r - 4), g.c[1] - Math.cos(a) * (g.r - 4)], g.top + 0.2, DATA.P));
}

// ------------------------------------------------------------------ focus (one body system lit, the rest stepped down)
const SYSTEMS = DATA.systems;
const buttons = Array.from(document.querySelectorAll("[data-sys-button]"));
function focus(name) {
  if (S.focus === name) return;
  S.focus = name;
  if (name) root.setAttribute("data-focus", name);
  else root.removeAttribute("data-focus");
  for (const el of items) el.toggleAttribute("data-on", Boolean(name) && (el.dataset.sys || "").split(" ").includes(name));
  for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.sysButton === name));
  stage.setAttribute("aria-valuetext", name ? SYSTEMS.find((s) => s.id === name).title : "whole body");
  writePanel(true);
}

// ------------------------------------------------------------------ numbers
const f0 = (v) => Math.round(v).toLocaleString("en");
const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);
function now() {
  const m = steady(S.e);
  const mealH = S.meal === null ? null : ((S.clock - S.meal) * TL) / 3600;
  const drinkH = S.drink === null ? null : ((S.clock - S.drink) * TL) / 3600;
  const g = mealH === null ? { stomach: 0, intestine: 0, glucose: GUT.glucoseBase, insulin: 6 } : meal(mealH);
  const urine = urineFlow(drinkH === null ? NaN : drinkH);
  return { m, mealH, drinkH, g, urine };
}
const panel = document.querySelector("[data-panel]");
const panelTitle = panel.querySelector("[data-title]");
const panelText = panel.querySelector("[data-text]");
const panelRows = panel.querySelector("[data-rows]");
function rowsFor(id, { m, g, urine, mealH }) {
  switch (id) {
    case "brain":
      return [["Breath commands", `${f0(m.rr)} /min`], ["Curl commands", `${f0(m.curlRate)} /min`], ["Brain → biceps", `${f0(S.lastDelayMs)} ms at ${BODY.nerveSpeed} m/s`], ["Brain blood flow", `≈ 0.75 L/min (${f0(m.brainFlow * 100)} % of output)`]];
    case "heart":
      return [["Heart rate", `${f0(m.hr)} beats/min`], ["Stroke volume", `${f0(m.sv)} mL`], ["Cardiac output", `${f1(m.co)} L/min`], ["O₂ taken out", `${f0(m.avDiff)} mL per L of blood`], ["Venous O₂ saturation", `${f0(m.satV * 100 * 0.98)} %`]];
    case "lungs":
      return [["Breathing rate", `${f0(m.rr)} /min`], ["Each breath", `${f2(m.vt)} L`], ["Air moved", `${f1(m.ve)} L/min`], ["O₂ in", `${f0(m.vo2)} mL/min`], ["CO₂ out", `${f0(m.vco2)} mL/min`]];
    case "gut":
      return [["Meal", mealH === null ? "none yet: press Eat" : `${f1(mealH)} h ago`], ["Still in the stomach", `${f0(g.stomach * 100)} %`], ["Blood glucose", `${f1(g.glucose)} mmol/L`], ["Insulin", `${f0(g.insulin)} mU/L`], ["Gut blood flow", `${f1(m.gutFlow * m.co)} L/min`]];
    case "kidney":
      return [["Filtered", `${BODY.gfr} mL/min`], ["Urine made", `${f1(urine)} mL/min`], ["Water taken back", `${f1(reabsorbed(urine) * 100)} %`], ["Bladder", `${f0(S.bladder)} mL${S.bladder > BODY.bladderUrge ? " · urge" : ""}`], ["Kidney blood flow", `${f1(m.kidneyFlow * m.co)} L/min`]];
    case "move":
      return [["Curls", `${f0(m.curlRate)} /min`], ["Muscle blood flow", `${f1(m.muscleFlow * m.co)} L/min`], ["O₂ used, whole body", `${f0(m.vo2)} mL/min`], ["Biceps length", `${f0(100 * lastLength / DATA.liveC.restLength)} % of rest`]];
    default:
      return [["Heart rate", `${f0(m.hr)} beats/min`], ["Breathing", `${f0(m.rr)} /min · ${f2(m.vt)} L`], ["Cardiac output", `${f1(m.co)} L/min`], ["O₂ used", `${f0(m.vo2)} mL/min`], ["Blood glucose", `${f1(g.glucose)} mmol/L`], ["Bladder", `${f0(S.bladder)} mL`]];
  }
}
let lastLength = DATA.liveC.restLength;
let panelKey = "";
function writePanel(force) {
  const snap = now();
  const id = S.focus;
  const sys = SYSTEMS.find((s) => s.id === id);
  if (force) {
    panelTitle.textContent = sys ? sys.title : "The whole body";
    panelText.innerHTML = sys ? sys.text : DATA.overview;
  }
  const rows = rowsFor(id, snap);
  const key = rows.map((r) => r[1]).join("|");
  if (force || key !== panelKey) {
    panelKey = key;
    panelRows.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  }
  const text = `${f0(snap.m.hr)} bpm · ${f0(snap.m.rr)} breaths/min · ${f1(snap.m.co)} L/min`;
  if (readout.textContent !== text) readout.textContent = text;
}

// ------------------------------------------------------------------ the loop
const effortInput = document.querySelector("[data-effort]");
const effortLabel = document.querySelector("[data-effort-label]");
const TOUR = [
  { at: 0, focus: null, effort: 0 },
  { at: 6, focus: "heart", effort: 0 },
  { at: 13, focus: "heart", effort: 0.6 },
  { at: 20, focus: "lungs", effort: 0.6 },
  { at: 27, focus: "move", effort: 0.6 },
  { at: 34, focus: "brain", effort: 0.3 },
  { at: 41, focus: "gut", effort: 0, act: "eat" },
  { at: 50, focus: "kidney", effort: 0, act: "drink" },
  { at: 60, focus: null, effort: 0 },
];
const TOUR_LEN = 66;
let tourClock = 0;
let tourStep = -1;
function runTour(dt) {
  tourClock = (tourClock + dt) % TOUR_LEN;
  let step = 0;
  TOUR.forEach((s, i) => { if (tourClock >= s.at) step = i; });
  if (step !== tourStep) {
    tourStep = step;
    const s = TOUR[step];
    focus(s.focus);
    pinned = s.focus;
    setEffort(s.effort, false);
    if (s.act === "eat") eat();
    if (s.act === "drink") drink();
  }
}
function setEffort(v, fromUser = true) {
  S.target = clamp(v, 0, 1);
  effortInput.value = String(Math.round(S.target * 100));
  effortLabel.textContent = S.target < 0.05 ? "rest" : S.target < 0.4 ? "light" : S.target < 0.75 ? "hard" : "all out";
  if (fromUser) interact();
}
function interact() {
  S.touring = false;
  S.idleAt = S.clock;
  run();
}
function eat() { S.meal = S.clock; run(); }
function drink() { S.drink = S.clock; run(); }

let frame = 0;
let last = 0;
let visible = false;
let panelTimer = 0;
function tick(t) {
  const dt = last ? Math.min((t - last) / 1000, 1 / 30) : 1 / 60;
  last = t;
  const calm = still.matches;
  S.clock += dt;
  if (!S.touring && !calm && S.clock - S.idleAt > 14) { S.touring = true; tourClock = 0; tourStep = -1; }
  if (S.touring) runTour(dt);
  // the body follows the work with a lag (about a minute in life, a few seconds here)
  S.e = calm ? S.target : ease(S.e, S.target, dt, 2.5);
  const m = steady(S.e);
  // heart
  S.beat = (S.beat + (dt * m.hr) / 60) % 1;
  const period = 60 / m.hr;
  const squeeze = calm ? 0 : beat(S.beat * period, m.hr);
  scaleAbout(parts.heart, DATA.heartPivot, 1 - 0.1 * squeeze);
  // blood: arterial marks surge with each beat, venous ones flow steadily; both scale with cardiac output
  const base = 9 * (m.co / 5);
  if (!calm) {
    S.p.art += dt * base * (0.45 + 2.2 * squeeze);
    S.p.vein += dt * base * 0.85;
  }
  // breathing: the volume curve drives the diaphragm; each breath starts with a command down the phrenic nerves
  const prev = S.breath;
  S.breath = (S.breath + (dt * m.rr) / 60) % 1;
  if (!calm && S.breath < prev) { fire("cord", 0, 0.22); fire("phrL", 0.22, 0.45); fire("phrR", 0.22, 0.45); }
  const vol = calm ? 0 : breath(S.breath * (60 / m.rr), m.rr, m.vt);
  lungsAt(DATA.lung.apex - DATA.lung.perL * vol);
  // arm curls at the rate the work asks for
  if (!calm && m.curlRate > 0.5) {
    S.nextCurl += (dt * m.curlRate) / 60;
    if (S.nextCurl >= 1) { S.nextCurl = 0; curl(); }
  }
  const since = S.clock - S.curlAt;
  const drive = since > 0.8 && since < 1.75 ? 1 : 0;
  S.drive = ease(S.drive, drive, dt, 0.08);
  const want = drive ? DATA.liveC.top : DATA.liveC.rest;
  S.theta = calm ? want : ease(S.theta, want, dt, drive ? 0.22 : 0.32);
  armAt(S.theta, S.drive);
  lastLength = LIVE.arm(S.theta, 0).length;
  // nerve impulses
  const vars = { cord: -200, arm: -200, phrL: -200, phrR: -200 };
  S.pulses = S.pulses.filter((p) => S.clock < p.at + p.dur);
  for (const p of S.pulses) {
    const u = (S.clock - p.at) / p.dur;
    if (u >= 0) vars[p.name] = -8 + u * (p.len + 8);
  }
  // digestion and kidneys (time-lapse)
  const snap = now();
  S.p.food += dt * 14;
  S.p.stool += dt * 3;
  S.p.urine += dt * 4 * snap.urine;
  const swallow = S.meal === null ? 0 : Math.max(0, 1 - (S.clock - S.meal) / 3);
  if (S.voidAt === null) {
    S.bladder += (dt * TL * snap.urine) / 60;
    if (S.bladder >= 420) S.voidAt = S.clock;
  } else {
    S.bladder = Math.max(30, S.bladder - dt * 160);
    if (S.bladder <= 30) S.voidAt = null;
  }
  scaleAbout(parts.bladder, DATA.bladderPivot, 0.6 + 0.35 * Math.cbrt(S.bladder / BODY.bladderMax));
  scaleAbout(parts.stomach, DATA.stomachPivot, 0.86 + 0.16 * snap.g.stomach + (calm ? 0 : 0.012 * Math.sin(S.clock * 2.2) * snap.g.stomach));
  needleAt(m.hr);
  const style = root.style;
  style.setProperty("--p-art", S.p.art.toFixed(1));
  style.setProperty("--p-vein", S.p.vein.toFixed(1));
  style.setProperty("--p-food", S.p.food.toFixed(1));
  style.setProperty("--p-stool", S.p.stool.toFixed(1));
  style.setProperty("--p-urine", S.p.urine.toFixed(1));
  style.setProperty("--o-food", Math.max(swallow, Math.min(1, snap.g.intestine * 2.5), Math.min(1, snap.g.stomach * 1.5) * (S.meal !== null && S.clock - S.meal < 3 ? 1 : 0)).toFixed(2));
  style.setProperty("--o-stool", "0.7");
  for (const [k, v] of Object.entries(vars)) style.setProperty(`--p-${k}`, v.toFixed(1));
  panelTimer -= dt;
  if (panelTimer <= 0) { panelTimer = 0.25; writePanel(false); }
  frame = visible && !calm ? requestAnimationFrame(tick) : 0;
}
function run() {
  if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); }
  if (still.matches) { tick(performance.now()); }
}
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);

// ------------------------------------------------------------------ zoom: the whole figure, or the head and torso where the organs are
const zoomButton = document.querySelector("[data-zoom]");
let zoomed = false;
let viewNow = null;
let viewFrame = 0;
function setZoom(on, instant = false) {
  zoomed = on;
  zoomButton.textContent = on ? "Show the whole figure" : "Zoom to the torso";
  zoomButton.setAttribute("aria-pressed", String(on));
  const target = on ? DATA.views.torso : DATA.views.full;
  const from = viewNow ?? target;
  const t0 = performance.now();
  cancelAnimationFrame(viewFrame);
  const step = (t) => {
    const u = instant || still.matches ? 1 : Math.min(1, (t - t0) / 650);
    const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
    viewNow = from.map((v, i) => v + (target[i] - v) * e);
    svg.setAttribute("viewBox", viewNow.map((v) => v.toFixed(2)).join(" "));
    if (u < 1) viewFrame = requestAnimationFrame(step);
  };
  step(t0);
}
zoomButton.addEventListener("click", () => { interact(); setZoom(!zoomed); });
setZoom(matchMedia("(max-width: 560px)").matches, true);

// ------------------------------------------------------------------ input
effortInput.addEventListener("input", () => setEffort(Number(effortInput.value) / 100));
document.querySelector("[data-eat]").addEventListener("click", () => { interact(); eat(); });
document.querySelector("[data-drink]").addEventListener("click", () => { interact(); drink(); });
document.querySelector("[data-curl]").addEventListener("click", () => { interact(); curl(); });
// a picked system stays lit; hovering the figure previews another and lets go when the pointer leaves
let pinned = null;
const pick = (name) => { pinned = name; focus(name); };
for (const b of buttons) b.addEventListener("click", () => { interact(); pick(pinned === b.dataset.sysButton ? null : b.dataset.sysButton); });
svg.addEventListener("pointerover", (event) => {
  const it = event.target.closest(".it[data-sys]");
  if (!it) return;
  const sys = it.dataset.sys.split(" ")[0];
  if (sys === "frame") return;
  interact();
  focus(sys);
});
stage.addEventListener("pointerleave", () => { S.idleAt = S.clock; if (!S.touring) focus(pinned); });
svg.addEventListener("click", (event) => {
  const it = event.target.closest(".it[data-sys]");
  const sys = it ? it.dataset.sys.split(" ")[0] : null;
  if (sys && sys !== "frame") { interact(); pick(sys); }
});
stage.addEventListener("keydown", (event) => {
  const ids = SYSTEMS.map((s) => s.id);
  const i = ids.indexOf(S.focus);
  let handled = true;
  if (event.key === "ArrowRight") setEffort(S.target + (event.shiftKey ? 0.25 : 0.1));
  else if (event.key === "ArrowLeft") setEffort(S.target - (event.shiftKey ? 0.25 : 0.1));
  else if (event.key === "ArrowDown") { interact(); pick(ids[(i + 1) % ids.length]); }
  else if (event.key === "ArrowUp") { interact(); pick(ids[(i - 1 + ids.length) % ids.length]); }
  else if (event.key === "Home") setEffort(0);
  else if (event.key === "End") setEffort(1);
  else if (event.key === " " || event.key === "Enter") { interact(); curl(); }
  else if (event.key === "Escape") { interact(); pick(null); }
  else if (/^[1-6]$/.test(event.key)) { interact(); pick(ids[Number(event.key) - 1]); }
  else handled = false;
  if (handled) event.preventDefault();
});
setEffort(0, false);
focus(null);
writePanel(true);
needleAt(steady(0).hr);
