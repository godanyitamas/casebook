// Builds spark-job.html: a bench on which one Spark job runs, from the action to the last output file.
// node build.mjs [--dark] [--audit]
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { JOB, SLOTS, schedule, cardsOf, totals } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// The figure kit comes from the anatomy skill (github.com/wheresryan22/anatomy, MIT); set ANATOMY_DIR if it is not installed in the default place.
const SKILL = process.env.ANATOMY_DIR ?? join(homedir(), ".claude/skills/anatomy");
const k = await import(join(SKILL, "kit/iso-kit.mjs"));
const G = await import(join(SKILL, "kit/lathe.mjs"));
const TB = await import(join(SKILL, "kit/tube.mjs"));
const A = await import(join(SKILL, "kit/audit.mjs"));
const { kitScript } = await import(join(SKILL, "scripts/inline-kit.mjs"));
const THEME = process.argv.includes("--dark") ? "dark" : "light";

// ---------------------------------------------------------------- world
// x along the bench (+x to the right), y toward the viewer, z up. One unit is about 1.6 px.
const W = 760;
const AZ = 58;
const EL = 31;
const BENCH = { x: -186, y: -104, w: 372, d: 202, r: 8 };
const BENCH_H = 12;
const FOOT_H = 5;

const DRIVER = { x: -50, y: -94, w: 100, d: 44, r: 3 }; // console body
const D_TOP = 30;
const WORKERS = [
  { x: -176, y: -64, w: 104, d: 64, r: 3 },
  { x: 72, y: -64, w: 104, d: 64, r: 3 },
];
const CH_TOP = 24; // chassis top
const EX_TOP = 27; // executor plate top
const SL_TOP = 35; // core slot housing top
const STORE = { x: -176, y: 22, w: 124, d: 54, r: 3 }; // input files
const OUTS = { x: 76, y: 22, w: 100, d: 54, r: 3 };
const CM = { x: -22, y: 66, w: 44, d: 16, r: 2.5 }; // cluster manager // output files
const HUB = { x: -17, y: 28, w: 34, d: 22, r: 2.5 };
const PL_H = 3; // plinth height: every machine stands on one, and its network socket is in it
const CABLE_Z = 1.6;
const CABLE_R = 0.75;

const CARD_T = 1.2; // card thickness
const IN_TRAY = (i) => ({ x: STORE.x + 7 + i * 14.4, y: STORE.y + 8, w: 12, d: 26, r: 1 });
const IN_Z = 10; // storage shelf top
const OUT_TRAY = (j) => ({ x: OUTS.x + 14 + j * 27, y: OUTS.y + 8, w: 18, d: 26, r: 1 });
const SLOT_PLAN = (w, c) => ({ x: w.x + 9 + c * 46, y: w.y + 7, w: 40, d: 24, r: 2 });
const RACK = (w) => ({ x: w.x + 6, y: w.y + 38, w: w.w - 12, d: 22, r: 2 });
const FILE_POS = (w, pos) => ({ x: RACK(w).x + 3.4 + pos * 10.8, y: RACK(w).y + 3, w: 8.6, d: 16, r: 0.8 });

// fit the bench and the tallest parts (tickets, the lever knob), then crop the card's height to the drawing
const FIT = [...k.boxCorners(BENCH, -BENCH_H - FOOT_H, 0), [DRIVER.x, DRIVER.y, 40], [20, -80, 56], [WORKERS[0].x + 10, WORKERS[0].y + 5, 46], [WORKERS[1].x + 10, WORKERS[1].y + 5, 46], [WORKERS[1].x + 96, WORKERS[1].y + 5, 46]];
const PAD = 20;
const H = (() => {
  const P0 = k.fitProjection(FIT, W, 2000, { pad: PAD, azimuth: AZ, elevation: EL });
  const ys = FIT.map((p) => k.iso(p, P0)[1]);
  return Math.ceil(Math.max(...ys) - Math.min(...ys) + 2 * PAD + 14);
})();
const P = k.fitProjection(FIT, W, H, { pad: PAD, azimuth: AZ, elevation: EL });
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const f2 = (v) => Math.round(v * 100) / 100;
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const X = [1, 0, 0];
const Y = [0, 1, 0];
const Z = [0, 0, 1];

const needleOf = (c, r, top, share, span, from) => {
  const a = from + share * span;
  return k.lineOnTop([c[0] - Math.sin(a) * 1.1, c[1] + Math.cos(a) * 1.1], [c[0] + Math.sin(a) * r, c[1] - Math.cos(a) * r], top + 0.15, P);
};

// ---------------------------------------------------------------- recorder
const R = A.recorder(P);
let SYS = "";
function put(name, ref, svg, shapes = [], { bias = 0, sys = SYS, id, cls, ...rest } = {}) {
  return R.put({ name: R.nameFor(name), at: ref, bias, svg, shapes, piece: "bench", sys, id, cls, ...rest });
}
function slab(name, plan, z, h, style = {}, { steps = 4, bevel = 0.5, extra = "", inner = "", bias = 0, id, cls, owner, ground } = {}) {
  const shape = R.solid(A.slab(plan, z, h, { name, owner, ...(ground ? { ground: true } : {}) }, steps));
  put(name, [plan.x + plan.w / 2, plan.y + plan.d / 2, z + h / 2], S(k.slabOf(plan, z, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, id, cls });
  return shape;
}
function cyl(name, cx, cy, r, z, h, style = {}, { steps = 28, bevel = 0, extra = "", inner = "", bias = 0, id, cls } = {}) {
  const shape = R.solid(A.cylinder(cx, cy, r, z, h, { name }));
  put(name, [cx, cy, z + h / 2], S(k.cylinder(cx, cy, r, z, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, id, cls });
  return shape;
}
function disc(name, F, s0, s1, r, style = {}, { extra = "", inner = "", bias = 0, id, cls, owner } = {}) {
  const shape = R.solid(A.disc(F, s0, s1, r, { name, owner }));
  put(name, G.add3(F.o, G.mul3(F.a, (s0 + s1) / 2)), S(G.disc(s0, s1, r, F, P, { bevel: 0.15 }), { tone: "mid", ...style, inner }) + extra, [shape], { bias, id, cls });
  return shape;
}
// a closed outline in the vertical plane y = const (a vent slot, a panel cut-out on a front face)
function slotOnY(y, x0, x1, z0, z1, r = 0.8) {
  const pts = [];
  const arc = (cx, cz, a0) => {
    for (let i = 0; i <= 5; i++) {
      const a = a0 + (i / 5) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]);
    }
  };
  arc(x1 - r, z1 - r, 0);
  arc(x0 + r, z1 - r, Math.PI / 2);
  arc(x0 + r, z0 + r, Math.PI);
  arc(x1 - r, z0 + r, (3 * Math.PI) / 2);
  return path3(pts, true);
}
function slotOnX(x, y0, y1, z0, z1, r = 0.8) {
  const pts = [];
  const arc = (cy, cz, a0) => {
    for (let i = 0; i <= 5; i++) {
      const a = a0 + (i / 5) * (Math.PI / 2);
      pts.push([x, cy + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  };
  arc(y1 - r, z1 - r, 0);
  arc(y0 + r, z1 - r, Math.PI / 2);
  arc(y0 + r, z0 + r, Math.PI);
  arc(y1 - r, z0 + r, (3 * Math.PI) / 2);
  return path3(pts, true);
}
const screws = (pts, z, size = 0.45) => Dots(pts.map(([x, y]) => at([x, y, z])), { size, tone: "mid" });
// a label plate: inset groove, three rule lines that stand for printed text, two screws
function labelPlate(name, plan, z, { lines = [0.8, 0.55, 0.68] } = {}) {
  const t = 0.7;
  const inset = k.planOutline(k.insetPlan(plan, 1.2), z + t, P, 3);
  const rules = lines.map((len, i) => k.lineOnTop([plan.x + 3.6, plan.y + 2.6 + i * ((plan.d - 5.2) / Math.max(1, lines.length - 1))], [plan.x + 3.6 + (plan.w - 7.2) * len, plan.y + 2.6 + i * ((plan.d - 5.2) / Math.max(1, lines.length - 1))], z + t, P)).join("");
  slab(name, plan, z, t, { tone: "lo" }, { steps: 3, bevel: 0, extra: Ln(inset, { tone: "faint" }) + Ln(rules, { tone: "lo", free: true }) + screws([[plan.x + plan.w - 2.4, plan.y + 2.4], [plan.x + plan.w - 2.4, plan.y + plan.d - 2.4]], z + t, 0.35) });
}

// ---------------------------------------------------------------- the bench (drawn first, under everything)
const back = [];
back.push(`<path class="iso-halo" d="${k.haloOf(BENCH, -BENCH_H - FOOT_H, BENCH_H, P)}"/>`);
for (const [x, y] of byDepth(k.corners(BENCH, 22))) {
  back.push(S(k.cylinder(x, y, 7, -BENCH_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 5.4, -BENCH_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
}
R.solid(A.slab(BENCH, -BENCH_H, BENCH_H, { name: "stand.bench", ground: true }));
back.push(`<g data-sys="bench">${S(k.slabOf(BENCH, -BENCH_H, BENCH_H, P, 8, 1.6), { tone: "mid", inner: Ln(k.sideSeam(BENCH, -5, P, 8), { tone: "faint" }) })}</g>`);
back.push(Ln(k.planOutline(k.insetPlan(BENCH, 5), 0, P), { tone: "lo" }));
const benchScrews = k.corners(BENCH, 10);
back.push(Ln(benchScrews.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
back.push(Dots(benchScrews.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
// ruler strip along the front edge: one major tick every 14.4, the pitch of the input trays
{
  const strip = { x: BENCH.x + 14, y: BENCH.y + BENCH.d - 12.5, w: BENCH.w - 28, d: 6, r: 1 };
  back.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 3.6, 4, strip.y + 0.8, 0.6, [1.8, 3.4], P);
  back.push(Ln(ticks.minor, { tone: "lo" }), Ln(ticks.major, { tone: "mid" }));
  back.push(Dots([at([strip.x + 2, strip.y + 3, 0.6]), at([strip.x + strip.w - 2, strip.y + 3, 0.6])], { size: 0.45 }));
}

// ---------------------------------------------------------------- network: sockets, the switch, cables
const SOCKETS = {}; // name -> { at (route end), axis (out of the face) }
function socket(name, face, p, axis, sys) {
  // a socket boss standing out of a plinth face, with the cable entering its outer face
  const F = G.frameAlong(p, axis);
  const len = 2.2;
  SYS = sys;
  disc(`${name}.socket`, F, 0, len, 1.25, { tone: "mid" }, { extra: Ln(G.circleOf(F, len, 0.75, P), { tone: "faint" }) });
  SOCKETS[name] = { end: G.add3(p, G.mul3(axis, len)), axis, face };
}

// the switch
SYS = "network";
slab("hub.plinth", k.insetPlan(HUB, -1.5), 0, PL_H, { tone: "lo" }, { steps: 3, bevel: 0.3 });
{
  const top = PL_H + 11;
  const vents = [0, 1, 2, 3, 4].map((i) => k.planOutline({ x: HUB.x + 5 + i * 5.2, y: HUB.y + 4, w: 2.2, d: 9, r: 1 }, top, P, 3)).join("");
  const ledsAt = [-12, -6, 0, 6, 12].map((x) => [x, HUB.y + HUB.d - 4]);
  slab("hub.body", HUB, PL_H, 11, { tone: "mid" }, { steps: 4, bevel: 0.6, inner: Ln(k.sideSeam(HUB, PL_H + 7.5, P, 4), { tone: "faint" }), extra: Ln(vents, { tone: "faint" }) + Ln(k.lineOnTop([HUB.x, HUB.y + HUB.d - 7.5], [HUB.x + HUB.w, HUB.y + HUB.d - 7.5], top, P), { tone: "faint" }) + screws([[HUB.x + 2.6, HUB.y + 2.6], [HUB.x + HUB.w - 2.6, HUB.y + 2.6]], top) });
  // a link lamp per port, blinking with traffic
  ["store", "A", "driver", "B", "out"].forEach((port, i) => {
    const [x, y] = ledsAt[i];
    cyl(`hub.led.${port}`, x, y, 1.15, top, 0.6, { tone: "mid" }, { steps: 14, id: `led-${port}`, cls: "led" });
  });
}
// sockets on the switch: three on its back face, one on each side
const HUB_BACK = HUB.y - 1.5;
socket("hub.driver", "back", [0, HUB_BACK, CABLE_Z], [0, -1, 0], "network");
socket("hub.A", "back", [-10, HUB_BACK, CABLE_Z], [0, -1, 0], "network");
socket("hub.B", "back", [10, HUB_BACK, CABLE_Z], [0, -1, 0], "network");
socket("hub.store", "left", [HUB.x - 1.5, 44, CABLE_Z], [-1, 0, 0], "network");
socket("hub.out", "right", [HUB.x + HUB.w + 1.5, 44, CABLE_Z], [1, 0, 0], "network");

// ---------------------------------------------------------------- the driver console
SYS = "driver";
const DP = k.insetPlan(DRIVER, -2);
slab("driver.plinth", DP, 0, 4, { tone: "lo" }, { steps: 3, bevel: 0.4 });
{
  const front = DRIVER.y + DRIVER.d;
  const vents = [0, 1, 2, 3, 4, 5].map((i) => slotOnY(front, -36 + i * 5, -33.6 + i * 5, 9, 21, 1)).join("");
  const handles = "";
  slab("driver.body", DRIVER, 4, D_TOP - 4, { tone: "mid" }, { steps: 4, bevel: 0.6, inner: Ln(k.sideSeam(DRIVER, 24, P, 4), { tone: "faint" }), extra: Ln(vents, { tone: "faint" }) + handles });
}
// handles on the console front, and a nameplate between them
for (const x of [10, 40]) {
  const front = DRIVER.y + DRIVER.d;
  slab("driver.handle", { x: x - 1.6, y: front, w: 3.2, d: 2.4, r: 0.8 }, 8, 2.2, { tone: "mid" }, { steps: 2, bevel: 0 });
  slab("driver.handle", { x: x - 1.6, y: front, w: 3.2, d: 2.4, r: 0.8 }, 17.8, 2.2, { tone: "mid" }, { steps: 2, bevel: 0 });
  slab("driver.handle.bar", { x: x - 1.3, y: front + 2.4, w: 2.6, d: 2.2, r: 1 }, 8, 12, { tone: "mid" }, { steps: 3, bevel: 0 });
}
slab("driver.top", k.insetPlan(DRIVER, -1), D_TOP, 2, { tone: "mid" }, { steps: 4, bevel: 0.6, extra: screws(k.corners(k.insetPlan(DRIVER, -1), 3), D_TOP + 2, 0.45) });
const DT = D_TOP + 2;
// the mimic panel: one lamp per task, stage 0 above, stage 1 below, the shuffle bus between them
const BOARD = { x: -44, y: -88, w: 60, d: 32, r: 2 };
const LAMP0 = Array.from({ length: 8 }, (_, i) => [BOARD.x + 6 + i * 6.9, BOARD.y + 8]);
const LAMP1 = [0, 1, 2].map((j) => [BOARD.x + 6 + (j * 3 + 1) * 6.9 + (j - 1) * 3.45 + 3.45, BOARD.y + 24]);
const BUS_Y = BOARD.y + 16;
SYS = "driver";
{
  const top = DT + 1.6;
  const groove = k.planOutline(k.insetPlan(BOARD, 1.6), top, P, 3);
  const drops0 = LAMP0.map(([x, y]) => k.lineOnTop([x, y + 2.3], [x, BUS_Y], top, P)).join("");
  const drops1 = LAMP1.map(([x, y]) => k.lineOnTop([x, BUS_Y], [x, y - 2.3], top, P)).join("");
  const bus = k.lineOnTop([LAMP0[0][0], BUS_Y], [LAMP0[7][0], BUS_Y], top, P);
  slab("driver.board", BOARD, DT, 1.6, { tone: "mid" }, {
    steps: 3,
    bevel: 0.4,
    extra:
      Ln(groove, { tone: "faint" }) +
      `<g data-id="mimic0">${Ln(drops0, { tone: "lo" })}</g><g data-id="bus">${Ln(bus, { tone: "lo" })}</g><g data-id="mimic1">${Ln(drops1, { tone: "lo" })}</g>` +
      screws(k.corners(BOARD, 2.6).filter((_, i) => i !== 2), top, 0.35),
  });
  LAMP0.forEach(([x, y], i) => {
    SYS = "driver stage task";
    cyl("driver.lamp0.bezel", x, y, 2.3, top, 0.8, { tone: "mid" }, { steps: 18 });
    cyl("driver.lamp0.lens", x, y, 1.5, top + 0.8, 0.9, { tone: "hi" }, { steps: 16, id: `lamp0-${i}`, cls: "lamp" });
  });
  LAMP1.forEach(([x, y], j) => {
    SYS = "driver stage task";
    cyl("driver.lamp1.bezel", x, y, 2.3, top, 0.8, { tone: "mid" }, { steps: 18 });
    cyl("driver.lamp1.lens", x, y, 1.5, top + 0.8, 0.9, { tone: "hi" }, { steps: 16, id: `lamp1-${j}`, cls: "lamp" });
  });
}
// the job lever in its quadrant
SYS = "driver job";
const QUAD = { x: 22, y: -91, w: 11, d: 22, r: 2 };
const PIVOT = [QUAD.x + QUAD.w / 2, QUAD.y + QUAD.d / 2, DT + 4 + 2.2];
const LEVER_LEN = 15;
slab("driver.quadrant", QUAD, DT, 4, { tone: "mid" }, { steps: 3, bevel: 0.5, extra: Ln(k.planOutline({ x: QUAD.x + QUAD.w / 2 - 1.3, y: QUAD.y + 3, w: 2.6, d: QUAD.d - 6, r: 1.2 }, DT + 4, P, 3), { tone: "lo" }) });
{
  const F = G.frameAlong([QUAD.x - 0.2, PIVOT[1], PIVOT[2]], X);
  disc("driver.pivot", F, 0, QUAD.w + 0.4, 2.2, { tone: "mid" }, { bias: 0.3 });
}
// lever geometry is shared with the page, which rebuilds it every frame it moves
const leverAt = (angle) => {
  const dir = [0, Math.sin(angle), Math.cos(angle)];
  const F = G.frameAlong(PIVOT, dir);
  const knob = G.add3(PIVOT, G.mul3(dir, LEVER_LEN));
  return { F, knob, rod: G.disc(Math.sqrt(2.2 * 2.2 - 0.9 * 0.9), LEVER_LEN - 2.2, 0.9, F, P, {}), ball: G.sphereOf(knob, 2.6, P, { steps: 36 }) };
};
const LEVER_REST = -0.42;
const LEVER_PULLED = 0.46;
{
  const L = leverAt(LEVER_REST);
  const rodShape = R.solid(A.disc(L.F, Math.sqrt(2.2 * 2.2 - 0.9 * 0.9), LEVER_LEN - 2.2, 0.9, { name: "driver.lever", seated: true }));
  const ballShape = R.solid(A.ball(L.knob, 2.6, { name: "driver.lever.knob" }));
  put("driver.lever", G.add3(PIVOT, [0, 0, 6]), `<g data-id="lever">${S(L.rod, { tone: "mid" })}${S(L.ball, { tone: "hi" })}</g>`, [rodShape, ballShape], { bias: 1 });
}
// task dial: one major tick per task of the job, the needle counts finished tasks
SYS = "driver job task";
const DIAL = { c: [39, -61], r: 8.5, z: DT, h: 4 };
const DIAL_SPAN = (300 / 360) * Math.PI * 2;
const DIAL_FROM = -DIAL_SPAN / 2;
const N_TASKS = 11;
{
  const { c, r, z, h } = DIAL;
  const top = z + h;
  const ticks = k.radialTicks(c[0], c[1], r - 2.6, N_TASKS * 2, 2, top, [1.1, 2.2], P, DIAL_FROM, DIAL_SPAN);
  const shape = R.solid(A.cylinder(c[0], c[1], r, z, h, { name: "driver.dial" }));
  put(
    "driver.dial",
    [c[0], c[1], z + h / 2],
    S(k.cylinder(c[0], c[1], r, z, h, P, 56, 0.6), { tone: "hi", crease: "lo", inner: Ln(k.sideArc(c[0], c[1], r, top - 1.6, P, 36), { tone: "faint" }) }) +
      Ln(k.knurl(c[0], c[1], r, z, top - 1.6, 60, P, 0.3), { tone: "lo" }) +
      Ln(k.ring(c[0], c[1], r - 1.6, top, P, 56), { tone: "lo" }) +
      Ln(ticks.minor, { tone: "lo" }) +
      Ln(ticks.major, { tone: "mid" }) +
      Ln(k.ring(c[0], c[1], 1.1, top, P, 14), { tone: "mid" }) +
      `<path class="iso-line" data-tone="lit" data-id="dial-needle" data-free="start" style="stroke-width:1.1" d="${needleOf(DIAL.c, DIAL.r - 3, DIAL.z + DIAL.h, 0, DIAL_SPAN, DIAL_FROM)}"/>`,
    [shape],
  );
}
// top screws and a nameplate on the console top
SYS = "driver";
labelPlate("driver.plate", { x: -44, y: -55, w: 26, d: 5, r: 1 }, DT);
socket("driver", "front", [0, DP.y + DP.d, CABLE_Z], [0, 1, 0], "network");

// ---------------------------------------------------------------- workers: chassis, executor, core slots, local disk
const SLOT_DIALS = [];
const TICKETS = [];
WORKERS.forEach((Wk, wi) => {
  const id = "AB"[wi];
  SYS = "worker";
  const plinth = k.insetPlan(Wk, -1.5);
  slab(`worker${id}.plinth`, plinth, 0, PL_H, { tone: "lo" }, { steps: 3, bevel: 0.4 });
  {
    const front = Wk.y + Wk.d;
    const vents = Array.from({ length: 9 }, (_, i) => slotOnY(front, Wk.x + 30 + i * 6, Wk.x + 32.4 + i * 6, PL_H + 4, PL_H + 13, 1)).join("");
    const side = Wk.x + Wk.w;
    const sideVents = Array.from({ length: 6 }, (_, i) => slotOnX(side, Wk.y + 10 + i * 7.5, Wk.y + 12.4 + i * 7.5, PL_H + 4, PL_H + 13, 1)).join("");
    slab(`worker${id}.chassis`, Wk, PL_H, CH_TOP - PL_H, { tone: "mid" }, { steps: 4, bevel: 0.6, inner: Ln(k.sideSeam(Wk, PL_H + 16, P, 4), { tone: "faint" }), extra: Ln(vents + sideVents, { tone: "faint" }) });
    // rack ears with a power lamp on the front
    for (const x of [Wk.x + 6, Wk.x + Wk.w - 9]) {
      slab(`worker${id}.ear`, { x, y: front, w: 3, d: 1.2, r: 0.5 }, PL_H + 2, 15, { tone: "mid" }, { steps: 2, bevel: 0 });
    }
    disc(`worker${id}.power`, G.frameAlong([Wk.x + 18, front, PL_H + 8.5], Y), 0, 0.8, 1.3, { tone: "hi" }, { id: `power-${id}`, cls: "lamp" });
    disc(`worker${id}.power.ring`, G.frameAlong([Wk.x + 18, front, PL_H + 8.5], Y), 0, 0.4, 2, { tone: "lo" }, { bias: -0.05 });
  }
  // the executor: a JVM is a process, drawn as the carrier plate its core slots are bolted to
  SYS = "executor";
  const EX = { x: Wk.x + 5, y: Wk.y + 4, w: Wk.w - 10, d: 31, r: 2 };
  slab(`exec${id}.plate`, EX, CH_TOP, EX_TOP - CH_TOP, { tone: "mid" }, { steps: 3, bevel: 0.5, extra: screws(k.corners(EX, 2.2), EX_TOP, 0.42), id: `exec-${id}` });
  // heap gauge strip on the plate's front edge: a JVM has a fixed heap, set when the executor starts
  {
    const strip = { x: EX.x + 4, y: EX.y + EX.d - 4.2, w: EX.w - 8, d: 3, r: 0.6 };
    const ticks = k.topTicks(strip.x + 1.5, strip.x + strip.w - 1.5, 2.25, 4, strip.y + 0.3, EX_TOP + 0.4, [1.1, 2.1], P);
    slab(`exec${id}.heap`, strip, EX_TOP, 0.4, { tone: "lo" }, { steps: 2, bevel: 0, extra: Ln(ticks.minor, { tone: "lo" }) + Ln(ticks.major, { tone: "mid" }) });
  }
  [0, 1].forEach((c) => {
    const slotIndex = SLOTS.findIndex((s) => s.exec === wi && s.core === c);
    SYS = "core executor";
    const sp = SLOT_PLAN(Wk, c);
    const housingTop = Ln(k.planOutline({ x: sp.x + 4, y: sp.y + 11.5, w: 18, d: 3, r: 1.2 }, SL_TOP, P, 3), { tone: "lo" }) + screws([[sp.x + 1.8, sp.y + 1.8], [sp.x + sp.w - 1.8, sp.y + 1.8], [sp.x + 1.8, sp.y + sp.d - 1.8]], SL_TOP, 0.38);
    slab(`slot${id}${c}.housing`, sp, EX_TOP, SL_TOP - EX_TOP, { tone: "mid" }, { steps: 3, bevel: 0.5, inner: Ln(k.sideSeam(sp, EX_TOP + 3, P, 3), { tone: "faint" }), id: `slot-${slotIndex}`, extra: housingTop });
    // reader roller between two bearing blocks
    const ry = sp.y + 7;
    const rz = SL_TOP + 2.6;
    for (const x of [sp.x + 3, sp.x + 21]) slab(`slot${id}${c}.bearing`, { x, y: ry - 2.5, w: 2.6, d: 5, r: 0.6 }, SL_TOP, 4.6, { tone: "mid" }, { steps: 2, bevel: 0.2 });
    {
      const F = G.frameAlong([sp.x + 5.6, ry, rz], X);
      const ribs = G.ribsOf(F, 0, 15.4, 2.1, 28, P, { fade: [0.1, 0.55] });
      disc(`slot${id}${c}.roller`, F, 0, 15.4, 2.1, { tone: "mid" }, { extra: k.fadedSvg(ribs, { tone: "lo" }), id: `roller-${slotIndex}` });
    }
    // ticket clip, and the ticket: the task the driver sent, standing in the clip while it runs
    SYS = "core task";
    const clip = { x: sp.x + 4, y: sp.y + 17.5, w: 18, d: 3.4, r: 0.8 };
    slab(`slot${id}${c}.clip`, clip, SL_TOP, 1.8, { tone: "mid" }, { steps: 2, bevel: 0.2, extra: Ln(k.planOutline({ x: clip.x + 1.5, y: clip.y + 1.2, w: clip.w - 3, d: 1, r: 0.4 }, SL_TOP + 1.8, P, 2), { tone: "lo" }) });
    const ticket = { x: clip.x + 2, y: clip.y + 1.3, w: clip.w - 4, d: 0.8, r: 0.2 };
    const tshape = R.solid(A.slab(ticket, SL_TOP + 1.8, 8, { name: `slot${id}${c}.ticket` }, 2));
    const rules = [0, 1, 2].map((i) => k.segment([ticket.x + 1.6, ticket.y + 0.8, SL_TOP + 7.8 - 1.6 - i * 1.6], [ticket.x + 1.6 + (ticket.w - 3.2) * [0.8, 0.5, 0.65][i], ticket.y + 0.8, SL_TOP + 7.8 - 1.6 - i * 1.6], P)).join("");
    put(`slot${id}${c}.ticket`, [ticket.x + ticket.w / 2, ticket.y + 0.4, SL_TOP + 6], `<g data-id="ticket-${slotIndex}" class="ticket">${S(k.slabOf(ticket, SL_TOP + 1.8, 8, P, 2), { tone: "hi", crease: "none" })}${Ln(rules, { tone: "lo", free: true })}</g>`, [tshape], { bias: 0.2 });
    TICKETS.push(slotIndex);
    // progress dial: the needle sweeps once while the task runs
    SYS = "core task";
    const dc = [sp.x + 31.5, sp.y + 10];
    const dr = 6;
    {
      const top = SL_TOP + 2.4;
      const ticks = k.radialTicks(dc[0], dc[1], dr - 1.8, 20, 5, top, [0.8, 1.6], P);
      const shape = R.solid(A.cylinder(dc[0], dc[1], dr, SL_TOP, 2.4, { name: `slot${id}${c}.dial` }));
      put(`slot${id}${c}.dial`, [dc[0], dc[1], SL_TOP + 1.2], S(k.cylinder(dc[0], dc[1], dr, SL_TOP, 2.4, P, 44, 0.4), { tone: "hi", crease: "lo" }) + Ln(k.ring(dc[0], dc[1], dr - 1.2, top, P, 44), { tone: "lo" }) + Ln(ticks.minor, { tone: "lo" }) + Ln(ticks.major, { tone: "mid" }) + Ln(k.ring(dc[0], dc[1], 0.8, top, P, 12), { tone: "mid" }) + `<path class="iso-line" data-tone="lit" data-id="needle-${slotIndex}" data-free="start" style="stroke-width:1" d="${needleOf(dc, dr - 2, top, 0, Math.PI * 2, 0)}"/>`, [shape]);
      SLOT_DIALS[slotIndex] = { c: dc, r: dr - 2, top };
    }
    // busy lamp
    SYS = "core";
    cyl(`slot${id}${c}.lamp.bezel`, sp.x + 36.5, sp.y + 20.5, 1.7, SL_TOP, 0.6, { tone: "mid" }, { steps: 14 });
    cyl(`slot${id}${c}.lamp`, sp.x + 36.5, sp.y + 20.5, 1.1, SL_TOP + 0.6, 0.7, { tone: "hi" }, { steps: 12, id: `busy-${slotIndex}`, cls: "lamp" });
  });
  // local disk: the shuffle-file rack, one place per map output written on this worker
  SYS = "worker shuffle";
  const rack = RACK(Wk);
  slab(`disk${id}.tray`, rack, CH_TOP, 1.4, { tone: "lo" }, { steps: 3, bevel: 0.4, extra: Ln(k.planOutline(k.insetPlan(rack, 1.4), CH_TOP + 1.4, P, 3), { tone: "faint" }) });
  // back wall of the file box, then a divider between every two file places
  slab(`disk${id}.wall`, { x: rack.x + 1.4, y: rack.y + 0.6, w: rack.w - 2.8, d: 1.6, r: 0.5 }, CH_TOP + 1.4, 4.2, { tone: "mid" }, { steps: 2, bevel: 0.2, extra: screws([[rack.x + 3, rack.y + 1.4], [rack.x + rack.w - 3, rack.y + 1.4]], CH_TOP + 5.6, 0.35) });
  for (let pos = 0; pos <= 8; pos++) {
    const x = rack.x + 3.4 + pos * 10.8 - 1.1;
    slab(`disk${id}.divider`, { x: x - 0.4, y: rack.y + 2.2, w: 0.8, d: 17.3, r: 0.3 }, CH_TOP + 1.4, 2.4, { tone: "mid" }, { steps: 2, bevel: 0 });
  }
});

// ---------------------------------------------------------------- storage: input files and output files
function shelf(name, plan, sys) {
  SYS = sys;
  slab(`${name}.plinth`, k.insetPlan(plan, -1.5), 0, PL_H, { tone: "lo" }, { steps: 3, bevel: 0.4 });
  const front = plan.y + plan.d;
  const count = name === "store" ? 4 : 3;
  const dw = (plan.w - 8) / count;
  const drawers = Array.from({ length: count }, (_, i) => slotOnY(front, plan.x + 4 + i * dw + 1, plan.x + 4 + (i + 1) * dw - 1, PL_H + 1, IN_Z - 1.2, 1)).join("");
  const tops = screws([[plan.x + 2.8, plan.y + 2.8], [plan.x + plan.w - 2.8, plan.y + 2.8]], IN_Z);
  slab(`${name}.body`, plan, PL_H, IN_Z - PL_H, { tone: "mid" }, { steps: 4, bevel: 0.6, extra: Ln(drawers, { tone: "lo" }) + tops });
  // ruler strip along the front of the shelf top
  const strip = { x: plan.x + 4, y: front - 7, w: plan.w - 8, d: 4.4, r: 0.8 };
  const ticks = k.topTicks(strip.x + 2, strip.x + strip.w - 2, 1.8, 4, strip.y + 0.4, IN_Z + 0.5, [1.2, 2.4], P);
  slab(`${name}.ruler`, strip, IN_Z, 0.5, { tone: "lo" }, { steps: 2, bevel: 0, extra: Ln(ticks.minor, { tone: "lo" }) + Ln(ticks.major, { tone: "mid" }) });
}
shelf("store", STORE, "storage");
shelf("outs", OUTS, "storage");
// drawer fronts with pulls on the shelf faces
for (const [name, plan, count] of [["store", STORE, 4], ["outs", OUTS, 3]]) {
  SYS = "storage";
  const front = plan.y + plan.d;
  const w = (plan.w - 8) / count;
  for (let i = 0; i < count; i++) {
    const x0 = plan.x + 4 + i * w;
    slab(`${name}.pull`, { x: x0 + w / 2 - 3, y: front, w: 6, d: 1.4, r: 0.6 }, PL_H + 3.2, 1.6, { tone: "mid" }, { steps: 2, bevel: 0 });
  }
}
// input trays, each with its deck: one input partition, ten cards of 100 k rows
const IN_CARDS = [];
for (let i = 0; i < 8; i++) {
  SYS = "storage";
  const tray = IN_TRAY(i);
  slab("store.tray", tray, IN_Z, 1, { tone: "lo" }, { steps: 2, bevel: 0.2 });
  slab("store.tray.back", { x: tray.x, y: tray.y - 1.6, w: tray.w, d: 1.6, r: 0.5 }, IN_Z, 7, { tone: "mid" }, { steps: 2, bevel: 0.2 });
  const keys = cardsOf(i);
  SYS = "partition";
  keys.forEach((key, c) => {
    const plan = { x: tray.x + 1, y: tray.y + 1.2, w: tray.w - 2, d: tray.d - 3, r: 0.5 };
    const z = IN_Z + 1 + c * CARD_T;
    const shape = R.solid(A.slab(plan, z, CARD_T, { name: `in${i}.card${c}` }, 2));
    put(`in${i}.card`, [plan.x + plan.w / 2, plan.y + plan.d / 2, z + CARD_T / 2], `<g class="cd" data-id="in-${i}-${c}" data-k="${key}">${S(k.slabOf(plan, z, CARD_T, P, 2), { tone: "hi", crease: "none" })}</g>`, [shape]);
    IN_CARDS.push({ i, c, key });
  });
}
// output trays: one per reduce partition, filling with the cards of one key bucket
for (let j = 0; j < JOB.shufflePartitions; j++) {
  SYS = "storage";
  const tray = OUT_TRAY(j);
  slab("outs.tray", tray, IN_Z, 1, { tone: "lo" }, { steps: 2, bevel: 0.2 });
  slab("outs.tray.back", { x: tray.x, y: tray.y - 1.6, w: tray.w, d: 1.6, r: 0.5 }, IN_Z, 7, { tone: "mid" }, { steps: 2, bevel: 0.2 });
  SYS = "partition";
  for (let m = 0; m < 8; m++) {
    const plan = { x: tray.x + 1, y: tray.y + 1.2, w: tray.w - 2, d: tray.d - 3, r: 0.5 };
    const z = IN_Z + 1 + m * CARD_T;
    const shape = R.solid(A.slab(plan, z, CARD_T, { name: `out${j}.card${m}` }, 2));
    put(`out${j}.card`, [plan.x + plan.w / 2, plan.y + plan.d / 2, z + CARD_T / 2], `<g class="cd" data-id="out-${j}-${m}" data-k="${j}" data-hide="">${S(k.slabOf(plan, z, CARD_T, P, 2), { tone: "hi", crease: "none" })}</g>`, [shape]);
  }
}
// map output files on each worker's local disk: three cards, one segment per reduce partition, sorted by partition
WORKERS.forEach((Wk, wi) => {
  SYS = "shuffle";
  for (let pos = 0; pos < 8; pos++) {
    const fp = FILE_POS(Wk, pos);
    for (let j = 0; j < 3; j++) {
      const z = CH_TOP + 1.4 + j * CARD_T;
      const shape = R.solid(A.slab(fp, z, CARD_T, { name: `disk${"AB"[wi]}.file${pos}.seg${j}` }, 2));
      put(`disk${"AB"[wi]}.seg`, [fp.x + fp.w / 2, fp.y + fp.d / 2, z + CARD_T / 2], `<g class="cd" data-id="mf-${wi}-${pos}-${j}" data-k="${j}" data-hide="">${S(k.slabOf(fp, z, CARD_T, P, 2), { tone: "hi", crease: "none" })}</g>`, [shape]);
    }
  }
});

// ---------------------------------------------------------------- the cluster manager
// It started the two executors when the application began; during a job it only watches that they stay alive.
SYS = "cluster";
slab("cm.plinth", k.insetPlan(CM, -1.5), 0, PL_H, { tone: "lo" }, { steps: 3, bevel: 0.4 });
{
  const front = CM.y + CM.d;
  const vents = Array.from({ length: 6 }, (_, i) => slotOnY(front, CM.x + 18 + i * 4.2, CM.x + 20 + i * 4.2, PL_H + 3, PL_H + 9, 0.9)).join("");
  const top = PL_H + 11;
  slab("cm.body", CM, PL_H, 11, { tone: "mid" }, { steps: 4, bevel: 0.6, inner: Ln(k.sideSeam(CM, PL_H + 2, P, 4), { tone: "faint" }), extra: Ln(vents, { tone: "faint" }) + screws([[CM.x + 2.4, CM.y + 2.4], [CM.x + CM.w - 2.4, CM.y + CM.d - 2.4]], top) });
  labelPlate("cm.plate", { x: CM.x + 25, y: CM.y + 4, w: 15, d: 8, r: 0.8 }, top);
  // one lamp per registered worker, blinking with its heartbeat
  [0, 1].forEach((wi) => {
    const x = CM.x + 6 + wi * 9;
    cyl("cm.lamp.bezel", x, CM.y + 8, 2.3, top, 0.8, { tone: "mid" }, { steps: 18 });
    cyl("cm.lamp", x, CM.y + 8, 1.5, top + 0.8, 0.9, { tone: "hi" }, { steps: 16, id: `beat-${wi}`, cls: "lamp" });
  });
}
socket("hub.cm", "front", [0, HUB.y + HUB.d + 1.5, CABLE_Z], [0, 1, 0], "network");
socket("cm", "back", [0, CM.y - 1.5, CABLE_Z], [0, -1, 0], "network");

// ---------------------------------------------------------------- sockets on the machines, then the cables
const WORKER_PORT_X = [-150, 150];
socket("A", "front", [WORKER_PORT_X[0], WORKERS[0].y + WORKERS[0].d + 1.5, CABLE_Z], [0, 1, 0], "network");
socket("B", "front", [WORKER_PORT_X[1], WORKERS[1].y + WORKERS[1].d + 1.5, CABLE_Z], [0, 1, 0], "network");
socket("store", "right", [STORE.x + STORE.w + 1.5, 44, CABLE_Z], [1, 0, 0], "network");
socket("out", "left", [OUTS.x - 1.5, 44, CABLE_Z], [-1, 0, 0], "network");

const CABLES = {};
function cable(name, control) {
  SYS = "network";
  const line = G.fillet(control, 7, 10, { P, tube: CABLE_R });
  R.route(`cable.${name}`, line, CABLE_R, { piece: "bench", limp: true });
  const pieces = TB.tubePieces(line, CABLE_R, P, { maxLength: 14, spacing: 0.8 });
  pieces.forEach((piece, index) => put(`cable.${name}:${index}`, piece.mid, TB.tubeSvg(piece, { tone: "mid" }), [A.tube(piece.points, piece.radii)], { route: `cable.${name}`, chunk: index }));
  CABLES[name] = line;
}
const mid = (y0, y1) => (y0 + y1) / 2;
cable("driver", [SOCKETS.driver.end, SOCKETS["hub.driver"].end]);
{
  const a = SOCKETS.A.end;
  const h = SOCKETS["hub.A"].end;
  const lane = mid(a[1], h[1]);
  cable("A", [a, [a[0], lane, CABLE_Z], [h[0], lane, CABLE_Z], h]);
}
{
  const a = SOCKETS.B.end;
  const h = SOCKETS["hub.B"].end;
  const lane = mid(a[1], h[1]);
  cable("B", [a, [a[0], lane, CABLE_Z], [h[0], lane, CABLE_Z], h]);
}
cable("store", [SOCKETS.store.end, SOCKETS["hub.store"].end]);
cable("out", [SOCKETS.out.end, SOCKETS["hub.out"].end]);
cable("cm", [SOCKETS.cm.end, SOCKETS["hub.cm"].end]);

// ---------------------------------------------------------------- settle and audit
A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
A.auditOrExit(R, P, { allow: [["driver.lever*", "driver.pivot"]] });

// ---------------------------------------------------------------- what the page needs
// Packets ride along the cables. Each cable is sampled from its machine end to the switch, with a flag for
// whether that point is hidden behind a machine (a camera ray from it hits a box), so a packet fades out there.
const BOXES = [
  [DP, 0, D_TOP + 2],
  ...WORKERS.map((w) => [k.insetPlan(w, -1.5), 0, SL_TOP]),
  [k.insetPlan(STORE, -1.5), 0, IN_Z],
  [k.insetPlan(OUTS, -1.5), 0, IN_Z],
  [k.insetPlan(HUB, -1.5), 0, PL_H + 11],
  [k.insetPlan(CM, -1.5), 0, PL_H + 11],
].map(([p, z0, z1]) => ({ min: [p.x, p.y, z0], max: [p.x + p.w, p.y + p.d, z1] }));
const hidden = (p) =>
  BOXES.some(({ min, max }) => {
    let t0 = 1e-3;
    let t1 = 1e4;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(V[a]) < 1e-9) {
        if (p[a] < min[a] || p[a] > max[a]) return false;
        continue;
      }
      let ta = (min[a] - p[a]) / V[a];
      let tb = (max[a] - p[a]) / V[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
    return true;
  });
const TRACKS = Object.fromEntries(
  Object.entries(CABLES).map(([name, line]) => {
    const dense = G.resample(line, 0.6);
    const pts = dense.map((p) => at([p[0], p[1], p[2] + CABLE_R * 0.6]).map(f2));
    const vis = dense.map((p) => (hidden([p[0], p[1], p[2] + CABLE_R]) ? 0 : 1));
    return [name, { pts, vis }];
  }),
);
const PLAN = schedule();
const T = totals();
const DATA = {
  P,
  slotDials: SLOT_DIALS,
  dial: { c: DIAL.c, r: DIAL.r - 3, top: DIAL.z + DIAL.h, span: DIAL_SPAN, from: DIAL_FROM },
  lever: { pivot: PIVOT, len: LEVER_LEN, rest: LEVER_REST, pulled: LEVER_PULLED },
  tracks: TRACKS,
  cards: cardsOf.toString(),
};

const CSS = `
.sj{--k0:#d0473f;--k1:#2f9a63;--k2:#3c63c9;--pk-data:#3a3a3e;--lamp-on:#26262a;--lamp-done:#a6a6aa}
.iso[data-theme="dark"] .sj{--k0:#ff7a70;--k1:#5fd497;--k2:#7aa2ff;--pk-data:#d4d4d4;--lamp-on:#f2f2f2;--lamp-done:#5a5a5a}
.cd[data-k="0"]{--kc:var(--k0)}.cd[data-k="1"]{--kc:var(--k1)}.cd[data-k="2"]{--kc:var(--k2)}
.cd[data-k="0"],.cd[data-k="1"],.cd[data-k="2"]{--kt:color-mix(in srgb,var(--kc) 26%,var(--anatomy-top));--ks:color-mix(in srgb,var(--kc) 55%,var(--anatomy-shade-1))}
.cd:not([data-k="-1"]) .iso-top{fill:var(--kt)}
.cd:not([data-k="-1"]) .iso-shade{fill:var(--ks)}
.cd:not([data-k="-1"]) .iso-edge{stroke:color-mix(in srgb,var(--kc) 70%,var(--anatomy-hi))}
.cd{transition:opacity .35s}
.cd[data-hide]{opacity:0}
.cd[data-read] .iso-edge{stroke:var(--anatomy-lit);stroke-width:1.1px}
.cd[data-k="-1"][data-read] .iso-shade{fill:color-mix(in srgb,var(--lamp-on) 35%,var(--anatomy-paper))}
.cd[data-k="-1"][data-read] .iso-top{fill:color-mix(in srgb,var(--lamp-on) 12%,var(--anatomy-paper))}
.cd[data-sent]{opacity:.42}
.ticket{transition:opacity .25s,transform .3s var(--anatomy-ease)}
.ticket[data-off]{opacity:0;transform:translateY(-4px)}
.ticket[data-k="0"] .iso-top,.ticket[data-k="0"] .iso-shade{fill:color-mix(in srgb,var(--k0) 30%,var(--anatomy-top))}
.ticket[data-k="1"] .iso-top,.ticket[data-k="1"] .iso-shade{fill:color-mix(in srgb,var(--k1) 30%,var(--anatomy-top))}
.ticket[data-k="2"] .iso-top,.ticket[data-k="2"] .iso-shade{fill:color-mix(in srgb,var(--k2) 30%,var(--anatomy-top))}
.ticket .iso-edge{stroke:var(--anatomy-lit)}
.lamp .iso-top,.led .iso-top,.lamp .iso-shade,.led .iso-shade{transition:fill .2s}
.lamp[data-s="run"] .iso-top,.led[data-s="on"] .iso-top{fill:var(--lamp-on)}
.lamp[data-s="run"] .iso-shade,.led[data-s="on"] .iso-shade{fill:color-mix(in srgb,var(--lamp-on) 80%,var(--anatomy-paper))}
.lamp[data-s="run"] .iso-edge,.led[data-s="on"] .iso-edge{stroke:var(--anatomy-lit)}
.lamp[data-s="done"] .iso-top{fill:var(--lamp-done)}
.lamp[data-s="wait"] .iso-edge{stroke:var(--anatomy-hi)}
[data-id="bus"] .iso-line,[data-id^="mimic"] .iso-line{transition:stroke .3s}
[data-id="bus"][data-s="on"] .iso-line,[data-id^="mimic"][data-s="on"] .iso-line{stroke:var(--anatomy-hi)}
.pk{fill:none;stroke-linecap:round;pointer-events:none}
.pk[data-kind="ticket"]{stroke:var(--anatomy-lit);stroke-width:2.2}
.pk[data-kind="status"]{stroke:var(--anatomy-mid);stroke-width:1.8}
.pk[data-kind="data"]{stroke:var(--pk-data);stroke-width:2.8}
.pk[data-kind="k0"]{stroke:var(--k0);stroke-width:2.8}.pk[data-kind="k1"]{stroke:var(--k1);stroke-width:2.8}.pk[data-kind="k2"]{stroke:var(--k2);stroke-width:2.8}
/* focus: the picked concept is lit, the rest steps down a tone */
.sj[data-focus] .it:not([data-on]){opacity:.55}
.sj[data-focus] .it[data-on] .iso-edge{stroke:var(--anatomy-lit)}
.sj[data-focus] .it[data-on] .iso-solid:not(.cd .iso-solid)>.iso-top{fill:var(--anatomy-lit-top)}
.it{transition:opacity .3s}
`;

const items = R.items.map((item) => `<g class="it${item.cls ? " " + item.cls : ""}"${item.sys ? ` data-sys="${item.sys}"` : ""}${item.id ? ` data-id="${item.id}"` : ""}>${item.svg}</g>`).join("");
const packets = `<g class="pk-layer" aria-hidden="true">${Array.from({ length: 28 }, () => `<path class="pk" d="" style="opacity:0"/>`).join("")}</g>`;
const svg = k.figureSvg({
  width: W,
  height: H,
  label: "A bench on which a Spark job runs: a driver console with a lamp per task and a job lever, two worker machines each carrying an executor with two core slots and a local-disk rack for shuffle files, a shelf of eight input card decks, a shelf of three output trays, and a network switch with a cable to each machine.",
  body: [...back, items, packets],
});

const CONCEPTS = [
  { id: "driver", title: "Driver", text: "Your program runs in the driver. When an action is called, the driver turns the query into a plan, cuts it into stages and tasks, and sends each task to a free core on an executor. The stage's code is broadcast once per stage; each task message (the ticket) only says which partition to work on. Executors read their partitions from storage themselves, so the data never passes through the driver. Each finished task reports back with a status, and the driver decides what runs next." },
  { id: "job", title: "Job", text: "A job is a set of stages the scheduler runs to produce one result. filter and repartition are transformations: they only describe the plan. write is an action, so pulling the lever makes Spark run it. The figure shows the classic case: one action, one job. With adaptive query execution (on by default since Spark 3.2), Spark SQL submits stage 0 as a job of its own and stage 1 as a second job, which lists stage 0 as skipped; and spark.read.parquet without a schema already ran a small job of its own to read a file footer. After the last task reports, the driver commits the write (the _SUCCESS file)." },
  { id: "stage", title: "Stage", text: "A stage is a run of steps that each task can do on its own partition without data from any other partition: read, filter and the first half of the shuffle are pipelined into stage 0, row by row, in one pass. A step that needs rows from every partition (repartition, groupBy, join) is a shuffle, and Spark cuts the job there. Stage 1 cannot start until every task of stage 0 has written its shuffle output: that is the bus on the lamp board." },
  { id: "task", title: "Task", text: "A task is one stage's code applied to one partition, on one core. A stage has exactly as many tasks as it has partitions: 8 in stage 0, 3 in stage 1. Each lamp on the driver is one task. The ticket in a core slot is the task it is running, and its dial shows how far through its partition it is." },
  { id: "partition", title: "Partition", text: "A partition is the slice of data one task works on. For files, Spark packs the input into splits of at most spark.sql.files.maxPartitionBytes (128 MB by default), but shrinks that size so every core gets work: on this 4-core cluster 1 GB in eight 128 MB files gives 8 partitions; on 16 cores the same files give 16. After a shuffle the count is the number you ask for (repartition(3) here; adaptive execution does not change it) or spark.sql.shuffle.partitions (200 by default, which adaptive execution may coalesce). The colours are the three key buckets: every input partition has rows of all three, every output partition has one." },
  { id: "executor", title: "Executor", text: "An executor is a JVM process that the cluster manager starts on a worker for this application. It has a fixed heap and a number of cores (spark.executor.cores); each core is a task slot, and tasks run in threads. Two executors with two cores each give four slots: 8 tasks run in two waves, and 3 tasks leave one slot idle." },
  { id: "core", title: "Core (task slot)", text: "One slot runs one task at a time (spark.task.cpus = 1). When a task finishes, its executor tells the driver, and the driver offers the slot the next pending task. Tasks take different times, so the second wave does not start together: each slot picks up work as soon as it frees. More partitions than slots means waves; fewer means idle slots." },
  { id: "worker", title: "Worker", text: "A worker is a machine in the cluster. The cluster manager (standalone, YARN or Kubernetes) starts executors on it. The worker's local disk is where shuffle files are written, and with the external shuffle service they can outlive the executor that wrote them." },
  { id: "shuffle", title: "Shuffle", text: "Each stage 0 task writes one file to its worker's local disk, its rows sorted by target partition, with an index of where each segment starts. Each stage 1 task then fetches its own segment from all 8 files: from the local disk when the file is on its own worker, over the network when it is not. The files stay on disk after they are read; a later job that needs the same shuffle can skip stage 0." },
  { id: "cluster", title: "Cluster manager", text: "The cluster manager (Spark standalone, YARN or Kubernetes) owns the machines. When the application starts, the driver asks it for executors, and it starts them on workers: here two executors with two cores each. It does not schedule tasks; the driver does. With a fixed number of executors, as here, it does nothing during a job except track which workers are alive (the heartbeat lamps; their timing is drawn, not Spark's). With dynamic allocation the driver would ask it for more executors or give some back." },
  { id: "network", title: "Network and storage", text: "Everything between machines goes through the network: task launches and status updates (small, white and grey here), input reads from storage, shuffle fetches between workers and output writes back to storage (coloured by key bucket). A shuffle adds a disk write, a network transfer and a wait for every map task, which is why a stage boundary costs time." },
];
const DATA_JSON = JSON.stringify({ ...DATA, concepts: CONCEPTS, plan: PLAN, totals: T, job: JOB });
const body = k.plateHtml({
  fig: "Fig 1",
  title: "Anatomy of a Spark job",
  hint: "Space runs a job · pick a part below",
  readout: "idle · 8 input partitions · 4 cores",
  keys: [
    { mark: "lit", label: "Running now: a task, its ticket, its partition, a launch" },
    { mark: "red", label: "Key bucket 0" },
    { mark: "green", label: "Key bucket 1" },
    { mark: "blue", label: "Key bucket 2 (grey cards are rows the filter drops)" },
  ],
  caption: `One action, shown as one job (adaptive execution, on by default, would list it as two). The driver cuts the job at the shuffle into stage 0 (read, filter, write shuffle files: 8 tasks, one per 128 MB input split) and stage 1 (fetch, write output: 3 tasks, one per shuffle partition), and runs the tasks on 2 executors with 2 cores each. One card is 100 k rows. Task times are plausible for 128 MB (not measured); launches, status updates and network transfers take milliseconds in a real cluster and are slowed down here.`,
  body: `<style>${CSS}</style><div class="iso-stage sj" tabindex="0" role="group" aria-label="Spark job figure. Space runs a job, P pauses, arrow keys or 1 to 9 pick a part to explain, Escape clears.">${svg}</div>`,
});
const controls = `
<div class="sj-controls">
  <div class="sj-actions"><button type="button" data-run>Run the job</button><button type="button" data-pause aria-pressed="false">Pause</button><label class="sj-speed">Speed <input type="range" min="25" max="200" value="100" data-speed aria-label="Playback speed"><b data-speed-label>1×</b></label></div>
  <div class="sj-parts" role="toolbar" aria-label="Parts of a Spark job">${CONCEPTS.map((c, i) => `<button type="button" data-concept="${c.id}" aria-pressed="false"><span>${i + 1}</span>${c.title}</button>`).join("")}</div>
</div>
<section class="sj-panel" aria-live="polite">
  <pre class="sj-code" data-code><span data-line="read">spark.read.parquet("events/")</span>            <i>// 8 files × 128 MB → 8 partitions</i>
<span data-line="filter">  .filter(col("type") === "click")</span>     <i>// narrow: pipelined into stage 0</i>
<span data-line="shuffle">  .repartition(3, col("user_id"))</span>      <i>// wide: shuffle → stage boundary</i>
<span data-line="write">  .write.parquet("clicks/")</span>            <i>// action → runs the plan</i></pre>
  <h2 data-title>One job, two stages, eleven tasks</h2>
  <p data-text></p>
  <dl data-rows></dl>
</section>`;
const PAGE_CSS = `
.sj-controls{display:grid;gap:10px;margin:14px 0 0}
.sj-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.sj-controls button{font:12px/1 var(--anatomy-mono);letter-spacing:.02em;color:var(--anatomy-strong);background:var(--anatomy-card);border:1px solid var(--anatomy-lo);border-radius:0;padding:8px 11px;cursor:pointer}
.sj-controls button:hover{border-color:var(--anatomy-mid)}
.sj-controls button[aria-pressed="true"]{border-color:var(--anatomy-strong);box-shadow:inset 0 0 0 1px var(--anatomy-strong)}
.sj-controls button span{color:var(--anatomy-muted);margin-right:7px}
.sj-speed{display:inline-flex;gap:8px;align-items:center;font:12px var(--anatomy-mono);color:var(--anatomy-muted);margin-left:auto}
.sj-speed b{color:var(--anatomy-strong);font-weight:500;min-width:3.2em}
.sj-parts{display:flex;flex-wrap:wrap;gap:6px}
.sj-panel{margin-top:16px;padding:16px 18px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);color:var(--anatomy-text);font-size:13.5px;line-height:1.6}
.sj-panel h2{margin:0 0 6px;font-size:13px;font-family:var(--anatomy-mono);text-transform:uppercase;letter-spacing:.1em;color:var(--anatomy-strong);font-weight:500}
.sj-panel p{margin:0 0 12px}
.sj-code{margin:0 0 14px;padding:10px 12px;background:var(--anatomy-page);font:12px/1.6 var(--anatomy-mono);color:var(--anatomy-muted);overflow-x:auto}
.sj-code i{font-style:normal;color:var(--anatomy-lo)}
.iso[data-theme="light"] .sj-code i{color:var(--anatomy-mid)}
.sj-code span{transition:color .3s}
.sj-code span[data-on]{color:var(--anatomy-strong);box-shadow:inset 2px 0 0 var(--anatomy-strong)}
.sj-panel dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px 18px;margin:0;font-family:var(--anatomy-mono);font-size:12px}
.sj-panel dl div{display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--anatomy-faint);padding-top:5px}
.sj-panel dt{color:var(--anatomy-muted)}
.sj-panel dd{margin:0;color:var(--anatomy-strong);font-variant-numeric:tabular-nums;text-align:right}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
@media (max-width:560px){.sj{overflow:hidden;margin:0 -8px}.sj .iso-svg{width:122%;margin-left:-11%}}
`;
const SRC = (file) => readFileSync(join(SKILL, "kit", file), "utf8");
const wrap = (src, name) => {
  const names = [...src.matchAll(/^export (?:const|function|let) (\w+)/gm)].map((m) => m[1]);
  return `const ${name} = (() => {\n${src.replace(/^import .*$/gm, "").replace(/^export /gm, "")}\nreturn { ${names.join(", ")} };\n})();\n`;
};
const script = kitScript() + "\n" + wrap(SRC("lathe.mjs"), "G") + `const DATA = ${DATA_JSON};\n` + readFileSync(join(HERE, "live.js"), "utf8");
const out = THEME === "light" ? "spark-job.html" : "spark-job-dark.html";
writeFileSync(join(HERE, out), k.pageHtml({ title: "Anatomy of a Spark job", theme: THEME, body: `<style>${PAGE_CSS}</style>` + body + controls, script, width: 820 }));
console.log("wrote", out, R.items.length, "items,", R.solids.length, "solids");
