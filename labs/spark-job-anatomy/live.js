// The page's loop: replays the model's schedule (DATA.plan) on the drawn parts. Inlined after the kit and G.
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const PLAN = DATA.plan;
const JOB = DATA.job;
const P = DATA.P;
const cardsOf = new Function(`return ${DATA.cards}`)();
const $ = (sel) => svg.querySelector(sel);
const byId = (id) => svg.querySelector(`[data-id="${id}"]`);
const set = (el, name, on, value = "") => {
  if (!el) return;
  if (on) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  } else if (el.hasAttribute(name)) el.removeAttribute(name);
};
const nMap = PLAN.nMap;
const nRed = PLAN.nRed;
const nTasks = nMap + nRed;
const HOLD = 4.2; // seconds the finished job stays on the bench before the tour runs it again

// ---------------------------------------------------------------- refs
const lamps0 = Array.from({ length: nMap }, (_, i) => byId(`lamp0-${i}`));
const lamps1 = Array.from({ length: nRed }, (_, j) => byId(`lamp1-${j}`));
const busy = DATA.slotDials.map((_, s) => byId(`busy-${s}`));
const tickets = DATA.slotDials.map((_, s) => byId(`ticket-${s}`));
const needles = DATA.slotDials.map((_, s) => byId(`needle-${s}`));
const inCards = Array.from({ length: nMap }, (_, i) => Array.from({ length: JOB.cardsPerPartition }, (_, c) => byId(`in-${i}-${c}`)));
const outCards = Array.from({ length: nRed }, (_, j) => Array.from({ length: nMap }, (_, m) => byId(`out-${j}-${m}`)));
const segs = (exec, pos, j) => byId(`mf-${exec}-${pos}-${j}`);
const beats = [0, 1].map((w) => byId(`beat-${w}`));
const leds = Object.fromEntries(["store", "A", "driver", "B", "out"].map((p) => [p, byId(`led-${p}`)]));
const power = ["A", "B"].map((id) => byId(`power-${id}`));
const lever = byId("lever");
const dialNeedle = byId("dial-needle");
const bus = byId("bus");
const mimic0 = byId("mimic0");
const mimic1 = byId("mimic1");
const pkEls = [...svg.querySelectorAll(".pk")];
const codeLines = Object.fromEntries([...document.querySelectorAll("[data-line]")].map((el) => [el.dataset.line, el]));
const titleEl = document.querySelector("[data-title]");
const textEl = document.querySelector("[data-text]");
const rowsEl = document.querySelector("[data-rows]");
power.forEach((el) => set(el, "data-s", true, "run"));

// ---------------------------------------------------------------- packets: every transfer the schedule implies
const EXEC = ["A", "B"];
const TRANSFERS = [];
for (const t of PLAN.tasks) {
  const ex = EXEC[t.exec];
  TRANSFERS.push({ from: "driver", to: ex, at: t.launch, took: t.start - t.launch, kind: "ticket" });
  TRANSFERS.push({ from: ex, to: "driver", at: t.end, took: t.done - t.end, kind: "status" });
  if (t.stage === 0) {
    const keys = cardsOf(t.index, JOB);
    const dur = t.end - t.start;
    const n = keys.length;
    // the task streams its split from storage: one packet per card, top card first
    for (let q = 0; q < n; q++) {
      const c = n - 1 - q;
      const arrive = t.start + ((q + 0.5) / n) * dur;
      TRANSFERS.push({ from: "store", to: ex, at: arrive - 0.65, took: 0.65, kind: keys[c] < 0 ? "data" : `k${keys[c]}` });
    }
  }
}
for (const f of PLAN.fetches) if (!f.local) TRANSFERS.push({ from: EXEC[f.from], to: EXEC[f.to], at: f.at, took: f.took, kind: `k${f.reduce}` });
for (const w of PLAN.writes) TRANSFERS.push({ from: EXEC[w.exec], to: "out", at: w.at, took: 0.6, kind: `k${w.reduce}` });
TRANSFERS.sort((a, b) => a.at - b.at);

const TRACKS = DATA.tracks;
const lengthOf = (pts) => {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return acc;
};
for (const tr of Object.values(TRACKS)) tr.acc = lengthOf(tr.pts);
// screen point and visibility at screen distance s along a track, from its machine end
function sample(tr, s) {
  const acc = tr.acc;
  const total = acc[acc.length - 1];
  s = Math.max(0, Math.min(total, s));
  let lo = 0;
  let hi = acc.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (acc[m] <= s) lo = m;
    else hi = m;
  }
  const f = acc[hi] > acc[lo] ? (s - acc[lo]) / (acc[hi] - acc[lo]) : 0;
  const a = tr.pts[lo];
  const b = tr.pts[hi];
  return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, v: tr.vis[lo] + (tr.vis[hi] - tr.vis[lo]) * f };
}
// a transfer runs machine → switch along its first cable, then switch → machine along the second
function packetAt(tr, u) {
  const A = TRACKS[tr.from];
  const B = TRACKS[tr.to];
  const la = A.acc[A.acc.length - 1];
  const lb = B.acc[B.acc.length - 1];
  const s = u * (la + lb);
  const half = 3.2;
  const pts = [];
  let vis = 0;
  for (let d = -half; d <= half + 1e-6; d += half / 3) {
    const at = s + d;
    const p = at <= la ? sample(A, at) : sample(B, lb - (at - la));
    pts.push(p);
    vis += p.v;
  }
  const centre = s <= la ? sample(A, s) : sample(B, lb - (s - la));
  return { d: "M" + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("L"), v: Math.min(centre.v, vis / pts.length), nearHub: Math.abs(s - la) < 18, onA: s <= la };
}

// ---------------------------------------------------------------- state at a time since the action
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const tasks0 = PLAN.tasks.filter((t) => t.stage === 0);
const tasks1 = PLAN.tasks.filter((t) => t.stage === 1);
const fileOf = Object.fromEntries(PLAN.mapFiles.map((f) => [f.task, f]));

let clock = -1; // seconds since the lever was pulled; < 0 means no job yet
let ran = false;
function draw(t) {
  const running = t >= 0;
  const finished = running && t >= PLAN.finished;
  // lever: pulled with the action, back when the job is done
  const pull = running ? smooth(0, 0.35, t) * (1 - smooth(PLAN.finished, PLAN.finished + 0.5, t)) : 0;
  drawLever(DATA.lever.rest + (DATA.lever.pulled - DATA.lever.rest) * pull);
  // lamps: waiting once the DAG is built, lit while the task is out, steady when it has reported back
  const planned = running && t >= JOB.plan * 0.5;
  tasks0.forEach((k) => set(lamps0[k.index], "data-s", planned, t >= k.done ? "done" : t >= k.launch ? "run" : "wait"));
  tasks1.forEach((k) => set(lamps1[k.index], "data-s", planned, t >= k.done ? "done" : t >= k.launch ? "run" : "wait"));
  set(mimic0, "data-s", planned && t < PLAN.stage0Done, "on");
  set(bus, "data-s", running && t >= PLAN.stage0Done - 0.01 && t < PLAN.submit1 + 0.6, "on");
  set(mimic1, "data-s", running && t >= PLAN.submit1 && !finished, "on");
  // slots
  const busyNow = [];
  DATA.slotDials.forEach((d, s) => {
    const task = PLAN.tasks.find((k) => k.slot === s && t >= k.start && t < k.end);
    busyNow[s] = !!task;
    set(busy[s], "data-s", !!task, "run");
    set(tickets[s], "data-off", !task);
    set(tickets[s], "data-k", !!task && task.stage === 1, task ? String(task.index) : "");
    const share = task ? (t - task.start) / (task.end - task.start) : 0;
    const a = share * Math.PI * 2;
    needles[s].setAttribute("d", lineOnTop([d.c[0] - Math.sin(a) * 0.8, d.c[1] + Math.cos(a) * 0.8], [d.c[0] + Math.sin(a) * d.r, d.c[1] - Math.cos(a) * d.r], d.top + 0.15, P));
  });
  // input decks: the cards a task has read so far are lit; the data stays in storage
  tasks0.forEach((k) => {
    const share = running && t >= k.start && t < k.end ? (t - k.start) / (k.end - k.start) : 0;
    const n = JOB.cardsPerPartition;
    inCards[k.index].forEach((el, c) => set(el, "data-read", share > 0 && share >= (n - c - 0.5) / n));
  });
  // shuffle files appear when their map task finishes; a segment is lit while it is fetched and dim once read
  for (const f of PLAN.mapFiles) {
    for (let j = 0; j < nRed; j++) {
      const el = segs(f.exec, f.pos, j);
      const fetch = PLAN.fetches.find((x) => x.task === f.task && x.reduce === j);
      set(el, "data-hide", !(running && t >= f.at));
      set(el, "data-read", running && t >= fetch.at && t < fetch.at + fetch.took);
      set(el, "data-sent", running && t >= fetch.at + fetch.took);
    }
  }
  // output trays fill as the reduce tasks write
  const writesBy = {};
  for (const w of PLAN.writes) (writesBy[w.reduce] ??= []).push(w);
  for (let j = 0; j < nRed; j++) writesBy[j].forEach((w, m) => set(outCards[j][m], "data-hide", !(running && t >= w.at + 0.6)));
  // packets
  const live = running ? TRANSFERS.filter((x) => t >= x.at && t < x.at + x.took) : [];
  const hubBusy = new Set();
  pkEls.forEach((el, i) => {
    const x = live[i];
    if (!x) {
      if (el.style.opacity !== "0") el.style.opacity = "0";
      return;
    }
    const u = (t - x.at) / x.took;
    const p = packetAt(x, u);
    el.setAttribute("d", p.d);
    el.setAttribute("data-kind", x.kind);
    el.style.opacity = (p.v * smooth(0, 0.06, u) * (1 - smooth(0.94, 1, u))).toFixed(2);
    if (p.nearHub) hubBusy.add(p.onA ? x.from : x.to);
  });
  for (const [port, el] of Object.entries(leds)) set(el, "data-s", hubBusy.has(port), "on");
  // the driver's task dial counts reports back
  const doneCount = running ? PLAN.tasks.filter((k) => t >= k.done).length : 0;
  dialTarget = doneCount / nTasks;
  // code lines
  const inStage0 = running && t >= JOB.plan && t < PLAN.stage0Done;
  const inStage1 = running && t >= PLAN.submit1 && !finished;
  set(codeLines.read, "data-on", inStage0);
  set(codeLines.filter, "data-on", inStage0);
  set(codeLines.shuffle, "data-on", inStage0 || inStage1 || (running && t >= PLAN.stage0Done && t < PLAN.submit1));
  set(codeLines.write, "data-on", (running && t < JOB.plan) || inStage1);
  // readout
  const done0 = tasks0.filter((k) => t >= k.done).length;
  const done1 = tasks1.filter((k) => t >= k.done).length;
  const cores = busyNow.filter(Boolean).length;
  let text;
  if (!running) text = ran ? "idle · Space runs the job again" : "idle · Space runs a job";
  else if (t < JOB.plan) text = "job 0 · planning: 2 stages, 11 tasks";
  else if (t < PLAN.stage0Done) text = `stage 0 · ${done0}/${nMap} tasks done · ${cores}/4 cores busy`;
  else if (t < PLAN.submit1 + JOB.launch) text = "stage 0 done · stage 1 submitted";
  else if (!finished) text = `stage 1 · ${done1}/${nRed} tasks done · ${cores}/4 cores busy`;
  else text = `job 0 succeeded · ${PLAN.finished.toFixed(1)} s · 3 files written`;
  if (readout.textContent !== text) readout.textContent = text;
  STATE = { t, running, finished, done0, done1, cores };
}
let STATE = {};
let beatClock = 0;
let dialTarget = 0;
let dialAt = 0;
function drawDial(share) {
  const d = DATA.dial;
  const a = d.from + share * d.span;
  dialNeedle.setAttribute("d", lineOnTop([d.c[0] - Math.sin(a) * 1.1, d.c[1] + Math.cos(a) * 1.1], [d.c[0] + Math.sin(a) * d.r, d.c[1] - Math.cos(a) * d.r], d.top + 0.15, P));
}
let leverShown = null;
function drawLever(angle) {
  if (leverShown !== null && Math.abs(angle - leverShown) < 1e-4) return;
  leverShown = angle;
  const L = DATA.lever;
  const dir = [0, Math.sin(angle), Math.cos(angle)];
  const F = G.frameAlong(L.pivot, dir);
  const knob = G.add3(L.pivot, G.mul3(dir, L.len));
  lever.innerHTML = solidSvg(G.disc(Math.sqrt(2.2 * 2.2 - 0.9 * 0.9), L.len - 2.2, 0.9, F, P, {}), { tone: "mid" }) + solidSvg(G.sphereOf(knob, 2.6, P, { steps: 36 }), { tone: "hi" });
}

// ---------------------------------------------------------------- the panel
const C = DATA.concepts;
const TOT = DATA.totals;
const OVERVIEW = "Pull the lever (Space) and the driver runs one job: it plans two stages, sends the 8 stage 0 tasks to the 4 free cores, waits for every shuffle file, then sends the 3 stage 1 tasks. Pick a part to light it and read what it is.";
let focus = null;
let preview = null;
const SYS = { driver: ["driver"], job: ["job"], stage: ["stage"], task: ["task"], partition: ["partition"], executor: ["executor"], core: ["core"], worker: ["worker"], shuffle: ["shuffle"], cluster: ["cluster"], network: ["network", "storage"] };
const items = [...svg.querySelectorAll(".it[data-sys]")];
const buttons = [...document.querySelectorAll("[data-concept]")];
function showFocus() {
  const id = preview ?? focus;
  if (id) stage.setAttribute("data-focus", id);
  else stage.removeAttribute("data-focus");
  const want = id ? SYS[id] : [];
  for (const el of items) {
    const sys = el.getAttribute("data-sys").split(" ");
    set(el, "data-on", !!id && sys.some((s) => want.includes(s)));
  }
  buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.concept === focus)));
  const c = C.find((x) => x.id === id);
  titleEl.textContent = c ? c.title : "One job, two stages, eleven tasks";
  textEl.textContent = c ? c.text : OVERVIEW;
  stage.setAttribute("aria-valuetext", c ? c.title : "whole job");
}
function rows() {
  const s = STATE;
  const t = s.t ?? -1;
  const read = s.running ? PLAN.tasks.filter((k) => k.stage === 0).reduce((a, k) => a + Math.max(0, Math.min(1, (t - k.start) / (k.end - k.start))), 0) * JOB.cardsPerPartition * JOB.rowsPerCard : 0;
  const written = s.running ? PLAN.mapFiles.filter((f) => t >= f.at).length * 3 * JOB.rowsPerCard : 0;
  const fetchedLocal = s.running ? PLAN.fetches.filter((f) => f.local && t >= f.at + f.took).length : 0;
  const fetchedRemote = s.running ? PLAN.fetches.filter((f) => !f.local && t >= f.at + f.took).length : 0;
  const out = s.running ? PLAN.writes.filter((w) => t >= w.at + 0.6).length * JOB.rowsPerCard : 0;
  const M = (v) => (v / 1e6).toFixed(1) + " M";
  const list = [
    ["input", `${TOT.totalMB / 1024} GB in ${JOB.files.length} files`],
    ["split size", `${TOT.maxSplit} MB → ${TOT.partitions} partitions`],
    ["slots", `2 executors × 2 cores = ${TOT.slots}`],
    ["stage 0 tasks done", `${s.done0 ?? 0} / ${nMap}`],
    ["stage 1 tasks done", `${s.done1 ?? 0} / ${nRed}`],
    ["cores busy", `${s.cores ?? 0} / ${TOT.slots}`],
    ["rows read", `${M(read)} / ${M(TOT.rowsIn)}`],
    ["shuffle written", `${M(written)} rows`],
    ["segments fetched", `${fetchedLocal} local · ${fetchedRemote} remote`],
    ["rows written", `${M(out)} / ${M(TOT.rowsKept)}`],
  ];
  const html = list.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join("");
  if (rowsEl.innerHTML !== html) rowsEl.innerHTML = html;
}

// ---------------------------------------------------------------- loop, tour, input
let frame = 0;
let last = 0;
let visible = false;
let paused = false;
let speed = 1;
let touring = !still.matches;
let idleTimer = 0;
let waitAt = 1.2; // tour: seconds of idle before it pulls the lever
let idle = 0;
function start() {
  clock = 0;
  ran = true;
  leverShown = null;
  if (still.matches) clock = PLAN.finished + 0.6;
  run();
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const step = paused ? 0 : dt * speed;
  if (clock >= 0) {
    clock += step;
    if (clock > PLAN.finished + HOLD && touring) {
      clock = -1;
      idle = 0;
    }
  } else if (touring) {
    idle += step;
    if (idle > waitAt) start();
  }
  draw(clock);
  beatClock += dt;
  beats.forEach((el, w) => set(el, "data-s", !still.matches && (beatClock + w * 1.7) % 3.4 < 0.28, "run"));
  dialAt = still.matches ? dialTarget : dialAt + (dialTarget - dialAt) * (1 - Math.exp(-dt / 0.2));
  drawDial(dialAt);
  rows();
  const settled = paused || (clock < 0 && !touring) || (clock > PLAN.finished + 1 && !touring && Math.abs(dialAt - dialTarget) < 1e-3);
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
function run() {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
}
function quiet() {
  touring = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    touring = !still.matches;
    idle = 0;
    run();
  }, 9000);
}
function runJob() {
  quiet();
  if (clock >= 0 && clock < PLAN.finished) return; // one job at a time, like one action at a time on one thread
  start();
}
new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) run();
}, { rootMargin: "120px 0px" }).observe(stage);

document.querySelector("[data-run]").addEventListener("click", runJob);
const pauseBtn = document.querySelector("[data-pause]");
const setPaused = (on) => {
  paused = on;
  pauseBtn.setAttribute("aria-pressed", String(on));
  pauseBtn.textContent = on ? "Resume" : "Pause";
  quiet();
  run();
};
pauseBtn.addEventListener("click", () => setPaused(!paused));
const speedEl = document.querySelector("[data-speed]");
const speedLabel = document.querySelector("[data-speed-label]");
speedEl.addEventListener("input", () => {
  speed = Number(speedEl.value) / 100;
  speedLabel.textContent = `${speed.toFixed(speed < 1 ? 2 : 1).replace(/\.?0+$/, "")}×`;
});
const pick = (id) => {
  focus = focus === id ? null : id;
  preview = null;
  showFocus();
  quiet();
  run();
};
buttons.forEach((b) => {
  b.addEventListener("click", () => pick(b.dataset.concept));
  b.addEventListener("pointerenter", () => {
    preview = b.dataset.concept;
    showFocus();
  });
  b.addEventListener("pointerleave", () => {
    preview = null;
    showFocus();
  });
});
// hovering a part previews what it is; a click picks it
const conceptOf = (el) => {
  const it = el.closest(".it[data-sys]");
  if (!it) return null;
  const sys = it.getAttribute("data-sys").split(" ");
  const order = ["task", "partition", "shuffle", "core", "executor", "job", "stage", "driver", "worker", "cluster", "network", "storage"];
  const hit = order.find((s) => sys.includes(s));
  return hit === "storage" ? "network" : hit ?? null;
};
svg.addEventListener("pointerover", (e) => {
  const id = conceptOf(e.target);
  if (id === preview) return;
  preview = id;
  showFocus();
});
svg.addEventListener("pointerleave", () => {
  preview = null;
  showFocus();
});
svg.addEventListener("click", (e) => {
  const id = conceptOf(e.target);
  if (e.target.closest('[data-id="lever"]')) return runJob();
  if (id) pick(id);
});
stage.addEventListener("keydown", (e) => {
  const ids = C.map((c) => c.id);
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    runJob();
  } else if (e.key === "p" || e.key === "P") setPaused(!paused);
  else if (e.key === "Escape") {
    focus = null;
    showFocus();
  } else if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const at = focus ? ids.indexOf(focus) : dir > 0 ? -1 : ids.length;
    focus = ids[(at + dir + ids.length) % ids.length];
    showFocus();
    quiet();
  } else if (/^[0-9]$/.test(e.key)) {
    const n = e.key === "0" ? 10 : Number(e.key);
    if (n <= ids.length) pick(ids[n - 1]);
  }
});
if (still.matches) {
  touring = false;
  clock = PLAN.finished + 0.6;
  ran = true;
}
showFocus();
draw(clock);
drawDial((dialAt = dialTarget));
rows();
