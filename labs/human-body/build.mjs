// Builds human-body.html: an anatomical automaton on a plinth whose organs are machines.
// node build.mjs [--light] [--audit]
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { BODY, steady } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// The figure kit comes from the anatomy skill (github.com/wheresryan22/anatomy, MIT); set ANATOMY_DIR if it is not installed in the default place.
const SKILL = process.env.ANATOMY_DIR ?? join(homedir(), ".claude/skills/anatomy");
const k = await import(join(SKILL, "kit/iso-kit.mjs"));
const G = await import(join(SKILL, "kit/lathe.mjs"));
const TB = await import(join(SKILL, "kit/tube.mjs"));
const A = await import(join(SKILL, "kit/audit.mjs"));
const { kitScript } = await import(join(SKILL, "scripts/inline-kit.mjs"));
const THEME = process.argv.includes("--light") ? "light" : "dark";

// ---------------------------------------------------------------- world
// x across the body (+x is the body's right), y front (+y is where the body faces), z up. 2 units = 1 cm.
const W = 640;
const H = 920;
const AZ = 64;
const EL = 22;

const PLATE = { x: -82, y: -52, w: 164, d: 122, r: 10 };
const PLATE_H = 12;
const FOOT_H = 5;
const POST = { x: -72, y: -44, w: 7, d: 7, r: 1 };
const POST_TOP = 372;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [POST.x, POST.y, POST_TOP + 4], [0, -10, 386], [60, 30, 300], [-60, -30, 300]],
  W,
  H,
  { pad: 26, azimuth: AZ, elevation: EL },
);
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const Faded = (list, style) => k.fadedSvg(list, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const rimOn = (R, a) => Math.sqrt(Math.max(0, R * R - a * a));
const UP = [0, 0, 1];
const vframe = (x, y, z = 0) => G.frameOf([x, y, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const f2 = (v) => Math.round(v * 100) / 100;
const LIVE_SRC = readFileSync(join(HERE, "live-geom.js"), "utf8");
const makeLive = new Function(`return ${LIVE_SRC}`)();

// ---------------------------------------------------------------- recorder
const R = A.recorder(P);
const record = R.solid;
let SYS = "frame";
function put(name, ref, svg, shapes = [], { bias = 0, sys = SYS, part, ...rest } = {}) {
  return R.put({ name: R.nameFor(name), at: ref, bias, svg, shapes, piece: "body", sys, part, ...rest });
}
function slab(name, plan, z, h, style = {}, { steps = 4, bevel = 0.5, extra = "", inner = "", bias = 0, part, owner } = {}) {
  const shape = record(A.slab(plan, z, h, { name, owner }, steps));
  put(name, [plan.x + plan.w / 2, plan.y + plan.d / 2, z + h / 2], S(k.slabOf(plan, z, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, part });
  return shape;
}
function extr(name, ring, z, h, style = {}, { convex = true, extra = "", inner = "", bias = 0, ref, part, bevel = 0 } = {}) {
  const shape = record(A.extruded(ring, z, h, { name }));
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  put(name, ref ?? [cx, cy, z + h / 2], S(k.extrude(ring, z, h, P, { convex, bevel }), { tone: "mid", ...style, inner }) + extra, [shape], { bias, part });
  return shape;
}
function turned(name, F, profile, style = {}, { extra = "", inner = "", bias = 0, smooth, steps, rims, bevel = 0, owner, part, ref, cut } = {}) {
  const opts = { bevel, ...(smooth !== undefined ? { smooth } : {}), ...(steps ? { steps } : {}), ...(rims ? { rims } : {}) };
  const paths = G.solidOf(profile, F, P, opts);
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  const shape = record(A.solid(F, profile, { name, owner, radius: smooth && smooth.radius ? smooth.radius : null, ...(cut ? { seated: true, cut } : {}) }));
  put(name, ref ?? G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias, part });
  return shape;
}
function disc(name, F, s0, s1, r, style = {}, options = {}) {
  return turned(name, F, [[s0, r], [s1, r]], style, options);
}
function ball(name, c, r, style = {}, { bias = 0, extra = "", part, owner, seated } = {}) {
  const shape = record(A.ball(c, r, { name, owner, ...(seated ? { seated: true } : {}) }));
  put(name, c, S(G.sphereOf(c, r, P, { steps: 40 }), { tone: "mid", ...style }) + extra, [shape], { bias, part });
  return shape;
}

// ---------------------------------------------------------------- tubes: vessels, gut, airway, nerves
const ROUTES = [];
const KIND = {
  art: { tone: "hi", dash: [0.01, 5.2], width: 1.5 },
  vein: { tone: "hi", dash: [0.01, 6.4], width: 1.5 },
  air: { tone: "mid", dash: [0.01, 7], width: 1.1 },
  gut: { tone: "mid", dash: [0.01, 9], width: 2.2 },
  urine: { tone: "mid", dash: [0.01, 6], width: 1.2 },
  nerve: { tone: "mid", dash: [7, 4000], width: 1.6 },
};
function flangeAt(name, centre, axis, r, thick, owner, { tone = "mid", bias = 0.05 } = {}) {
  const F = G.frameAlong(centre, axis);
  const shape = record(A.disc(F, -thick / 2, thick / 2, r, { name, owner }));
  const facing = Math.abs(G.dot3(axis, V)) > 0.3 && r > 2.4;
  const bolts = facing ? Dots(G.dotsOf(F, G.dot3(axis, V) > 0 ? thick / 2 : -thick / 2, r * 0.72, 6, P, { all: true }), { size: 0.35, tone: "mid" }) : "";
  put(name, centre, S(G.disc(-thick / 2, thick / 2, r, F, P, { bevel: 0.2 }), { tone }) + bolts, [shape], { bias, route: owner });
}
function pipe(name, control, r, kind, { bend = 2.8, flanges = [true, true], flangeR = 1.5, rings, maxLength = 14, bias = 0, gaps: extra0 = [], breaks = [], caps, tone, touch, limp = false, flow = true, tees = [], flowVar, flowBase = 0 } = {}) {
  const line = G.fillet(control, Math.max(r * bend, 2.4), r > 2 ? 14 : 10, { P, tube: r });
  const total = G.pathLength(line);
  let extra = extra0;
  const teeAt = {};
  for (const tee of tees) {
    const along = tee.near ? alongNear(line, tee.near) : tee.at <= 1 ? tee.at * total : tee.at;
    const c = G.pointAlong(line, along);
    const half = rimOn(tee.r, r);
    extra = [...extra, [along - half, along + half]];
    ball(tee.name, c, tee.r, { tone: "mid" }, { owner: name });
    teeAt[tee.name] = c;
  }
  const thick = Math.max(0.9, r * 0.5);
  const collars = [];
  [[0, -1], [total, 1]].forEach(([along, sign], index) => {
    if (!flanges[index]) return;
    const tangent = G.tangentAlong(line, along);
    collars.push({ centre: G.add3(G.pointAlong(line, along), G.mul3(tangent, (-sign * thick) / 2)), tangent, gap: sign < 0 ? [0, thick] : [total - thick, total] });
  });
  const gaps = [...collars.map(({ gap }) => gap), ...extra];
  const K = KIND[kind];
  R.route(name, line, r, { gaps, touch, limp, rims: flanges.map((on) => (on ? r * flangeR : r)), piece: "body" });
  const pieces = TB.tubePieces(line, r, P, { maxLength, spacing: Math.max(0.6, Math.min(2, r * 0.5)), gaps, breaks, ...(rings ? { rings } : {}), ...(caps ? { caps } : {}) });
  // screen arc length along the whole route, so flow marks run through chunk joints without a restart
  const dense = G.resample(line, 0.5);
  const screenAt = [0];
  for (let i = 1; i < dense.length; i++) {
    const a = at(dense[i - 1]);
    const b = at(dense[i]);
    screenAt.push(screenAt[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const screenOf = (along) => {
    const i = Math.min(dense.length - 1, Math.max(0, Math.round((along / total) * (dense.length - 1))));
    return screenAt[i];
  };
  pieces.forEach((piece, index) => {
    const flowPath = flow ? `<path class="fl" data-k="${kind}" d="${path3(G.cut(line, Math.max(0, piece.from), Math.min(total, piece.to)))}" style="--o:${f2(flowBase + screenOf(Math.max(0, piece.from)))}${flowVar ? `;--p:var(--p-${flowVar},-200);opacity:var(--o-${flowVar},1)` : ""}"/>` : "";
    put(`${name}:${index}`, piece.mid, `<g class="vs" data-k="${kind}">${TB.tubeSvg(piece, { tone: tone ?? K.tone })}${flowPath}</g>`, [A.tube(piece.points, piece.radii)], { bias, route: name, chunk: index });
  });
  collars.forEach(({ centre, tangent }, index) => flangeAt(`${name}.fl${index}`, centre, tangent, r * flangeR, thick, name));
  ROUTES.push({ name, kind, length: total, screen: screenAt[screenAt.length - 1], sys: SYS });
  line.tees = teeAt;
  line.total = total;
  return line;
}
// a run of pipe that turns inside elbow balls at the given control points (rim on sphere at both sides)
function elbowed(name, control, r, kind, elbows, opts = {}) {
  const R0 = r * 1.45;
  const cuts = [...elbows].sort((a, b) => a - b);
  let from = 0;
  let start = control[0];
  let lines = [];
  let base = opts.flowBase ?? 0;
  const advance = () => { base += ROUTES[ROUTES.length - 1].screen + 2 * R0 * KS; };
  cuts.forEach((at, j) => {
    const corner = control[at];
    const inDir = G.unit3(G.sub3(corner, control[at - 1]));
    const outDir = G.unit3(G.sub3(control[at + 1], corner));
    const pts = [start, ...control.slice(from + 1, at), G.sub3(corner, G.mul3(inDir, rimOn(R0, r)))];
    lines.push(pipe(`${name}${j ? "." + j : ""}`, pts, r, kind, { ...opts, tees: j === 0 ? opts.tees ?? [] : [], flowBase: base, flanges: [j === 0 ? (opts.flanges ?? [true, true])[0] : false, false], caps: [j === 0 ? (opts.caps ?? [true, true])[0] : false, false] }));
    advance();
    ball(`${name}.elbow${j}`, corner, R0, { tone: "mid" });
    start = G.add3(corner, G.mul3(outDir, rimOn(R0, r)));
    from = at;
  });
  lines.push(pipe(`${name}.${cuts.length}`, [start, ...control.slice(from + 1)], r, kind, { ...opts, tees: [], flowBase: base, flanges: [false, (opts.flanges ?? [true, true])[1]], caps: [false, (opts.caps ?? [true, true])[1]] }));
  return lines;
}
function tee(name, c, r) {
  return ball(name, c, r, { tone: "mid" });
}
function alongNear(line, p) {
  const dense = G.resample(line, 0.25);
  let best = 0;
  let bestD = Infinity;
  let walked = 0;
  dense.forEach((q, i) => {
    if (i) walked += G.len3(G.sub3(q, dense[i - 1]));
    const d = G.len3(G.sub3(q, p));
    if (d < bestD) { bestD = d; best = walked; }
  });
  return best;
}
// a branch leaving a tee ball: starts where its rim meets the ball
const fromBall = (c, R, r, dir) => G.add3(c, G.mul3(G.unit3(dir), rimOn(R, r)));

// ---------------------------------------------------------------- plinth (drawn first, outside the sorted layer)
const back = [];
back.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
  back.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
}
back.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: Ln(k.sideSeam(PLATE, -4, P, 8), { tone: "faint" }) }));
back.push(Ln(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
const plateScrews = k.corners(PLATE, 10);
back.push(Ln(plateScrews.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
back.push(Dots(plateScrews.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
record(A.slab(PLATE, -PLATE_H, PLATE_H, { name: "stand.plate", ground: true }, 8));
const STRIP = { x: PLATE.x + 24, y: PLATE.y + PLATE.d - 12, w: PLATE.w - 48, d: 6, r: 1 };
back.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
const ticks = k.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 4, 5, STRIP.y, 0.6, [1.8, 3.4], P);
back.push(Ln(ticks.minor, { tone: "lo" }), Ln(ticks.major, { tone: "mid" }));
back.push(Dots([at([STRIP.x + 2, STRIP.y + 3, 0.6]), at([STRIP.x + STRIP.w - 2, STRIP.y + 3, 0.6])], { size: 0.45 }));
// round display base under the figure
const DAIS = { c: [0, -2], r: 45 };
back.push(S(k.cylinder(DAIS.c[0], DAIS.c[1], DAIS.r, 0, 3, P, 96, 0.8), { tone: "mid" }));
back.push(Ln(k.ring(DAIS.c[0], DAIS.c[1], DAIS.r - 4, 3, P, 96), { tone: "faint" }));
const dsc = k.radialTicks(DAIS.c[0], DAIS.c[1], DAIS.r - 0.6, 72, 6, 3, [1.2, 2.4], P);
back.push(Ln(dsc.minor, { tone: "lo" }), Ln(dsc.major, { tone: "mid" }));
record(A.cylinder(DAIS.c[0], DAIS.c[1], DAIS.r, 0, 3, { name: "stand.dais", ground: true }));

// ---------------------------------------------------------------- on the plinth: the skull cap, a heart-rate dial, a height post
SYS = "frame";
{
  // skull cap, set down on three felt pads
  const CAP = [-55, 42];
  const CF = vframe(CAP[0], CAP[1], 1.2);
  const capR = (s) => 21.8 * Math.sqrt(Math.max(0, 1 - (s / 13.6) ** 2));
  const capSlope = (s) => { const u = Math.min(0.999, s / 13.6); return (-21.8 * u) / (13.6 * Math.sqrt(1 - u * u)); };
  for (const a of [0.3, 2.4, 4.5]) put("cap.pad", [CAP[0] + 18 * Math.cos(a), CAP[1] + 18 * Math.sin(a), 0.6], S(k.cylinder(CAP[0] + 18 * Math.cos(a), CAP[1] + 18 * Math.sin(a), 2.2, 0, 1.2, P, 16), { tone: "lo" }), [record(A.cylinder(CAP[0] + 18 * Math.cos(a), CAP[1] + 18 * Math.sin(a), 2.2, 0, 1.2, { name: "cap.pad" }))]);
  const capProfile = [[0, 21.8], ...Array.from({ length: 20 }, (_, i) => { const s = 13.6 * Math.sin((((i + 1) / 21) * Math.PI) / 2); return [s, capR(s), 1]; }), [13.6, 0]];
  turned("cap", CF, capProfile, { tone: "mid" }, { smooth: { slope: capSlope }, inner: Ln(G.arcOf(CF, 1.6, capR(1.6), P, { slope: capSlope(1.6) }), { tone: "faint" }) });
}
const GAUGE = { c: [54, 42], r: 16, z: 0, h: 9 };
{
  const { c, r, h } = GAUGE;
  slab("gauge.base", { x: c[0] - r - 3, y: c[1] - r - 3, w: 2 * r + 6, d: 2 * r + 6, r: 4 }, 0, 2.4, { tone: "lo" }, { steps: 6, bevel: 0.4, extra: Dots(k.corners({ x: c[0] - r - 3, y: c[1] - r - 3, w: 2 * r + 6, d: 2 * r + 6 }, 2.6).map(([x, y]) => at([x, y, 2.4])), { size: 0.45 }) });
  const top = 2.4 + h;
  const ticks = k.radialTicks(c[0], c[1], r - 3, 48, 4, top, [1.3, 2.8], P);
  turned("gauge", vframe(c[0], c[1]), [[2.4, r], [top, r]], { tone: "hi", crease: "lo" }, { extra: Ln(k.knurl(c[0], c[1], r, top - 3.2, top, 72, P, 0.3), { tone: "lo" }) + Ln(k.ring(c[0], c[1], r - 2.2, top, P, 64), { tone: "lo" }) + Ln(ticks.minor, { tone: "lo" }) + Ln(ticks.major, { tone: "mid" }) + Ln(k.ring(c[0], c[1], 1.6, top, P, 16), { tone: "mid" }) + k.faceTextSvg(k.topMatrix([c[0], c[1] + 7], top, P, "x"), "BPM", { size: 2.4, tone: "lo", anchor: "middle" }) + `<path data-part="needle" class="iso-line" data-tone="lit" data-free="start" style="stroke-width:1.1" d=""/>` });
  GAUGE.top = top;
}
{
  // height post: a square bar with a tick every 10 cm (20 units) on its front face, longer every 50 cm
  const f = POST.y + POST.d;
  slab("post.foot", k.insetPlan(POST, -3), 0, 3, { tone: "lo" }, { steps: 3, bevel: 0.4 });
  const tickD = [];
  const majorD = [];
  for (let z = 20; z < POST_TOP; z += 20) (z % 100 === 0 ? majorD : tickD).push(k.segment([POST.x, f, z], [POST.x + (z % 100 === 0 ? 3.4 : 2.4), f, z], P));
  slab("post", POST, 3, POST_TOP - 3, { tone: "mid" }, { steps: 2, bevel: 0.3, extra: Ln(tickD.join(""), { tone: "lo" }) + Ln(majorD.join(""), { tone: "mid" }) });
  slab("post.cap", k.insetPlan(POST, -1), POST_TOP, 2, { tone: "mid" }, { steps: 2, bevel: 0.3 });
}

// ---------------------------------------------------------------- legs
const LEG_X = 17;
const LEG_Y = -4;
const DZ = 3; // dais top
SYS = "move";
for (const side of [-1, 1]) {
  const x = side * LEG_X;
  const foot = { x: x - 7.5, y: -16, w: 15, d: 32, r: 6 };
  slab(`foot${side}.sole`, foot, DZ, 2.4, { tone: "lo" }, { steps: 6, bevel: 0.4 });
  slab(`foot${side}.arch`, k.insetPlan({ ...foot, y: foot.y, d: foot.d - 8 }, 1), DZ + 2.4, 5, { tone: "mid" }, { steps: 6, bevel: 0.6 });
  // toes: five rounded pads at the front of the sole
  for (let t = 0; t < 5; t++) {
    const tx = x - 5.6 + t * 2.8;
    put(`foot${side}.toe${t}`, [tx, foot.y + foot.d - 5, DZ + 3.2], S(k.cylinder(tx, foot.y + foot.d - 5, 1.3, DZ + 2.4, 1.6 + (t === (side > 0 ? 0 : 4) ? 0.6 : 0), P, 14), { tone: "mid" }), [record(A.cylinder(tx, foot.y + foot.d - 5, 1.3, DZ + 2.4, 1.6, { name: `foot${side}.toe${t}` }))]);
  }
  const ankle = [x, LEG_Y, DZ + 7.4 + 5];
  const knee = [x, LEG_Y, 96];
  const hip = [x, LEG_Y, 169];
  const ankleB = ball(`ankle${side}`, ankle, 5, { tone: "mid" });
  const kneeB = ball(`knee${side}`, knee, 6.5, { tone: "mid" });
  const hipB = ball(`hip${side}`, hip, 8.5, { tone: "mid" });
  turned(`shin${side}`, vframe(x, LEG_Y), [[ankle[2] + rimOn(5, 4), 4], [30, 5.4, 1], [52, 6.4, 1], [72, 5.8, 1], [88, 5.1, 1], [knee[2] - rimOn(6.5, 5.5), 5.5]], { tone: "mid" }, { cut: [ankleB, kneeB], inner: Ln(G.arcOf(vframe(x, LEG_Y), 60, 6.25, P, { slope: -0.03 }), { tone: "faint" }) });
  // kneecap: a small disc on the front of the knee ball
  const capF = G.frameAlong([x, LEG_Y + rimOn(6.5, 3.2), 96], [0, 1, 0]);
  disc(`kneecap${side}`, capF, 0, 1.6, 3.2, { tone: "mid" }, { owner: `knee${side}`, cut: [kneeB] });
  turned(`thigh${side}`, vframe(x, LEG_Y), [[knee[2] + rimOn(6.5, 6), 6], [112, 8.6, 1], [136, 10.2, 1], [156, 9.2, 1], [hip[2] - rimOn(8.5, 8), 8]], { tone: "mid" }, { cut: [kneeB, hipB], inner: Ln(G.arcOf(vframe(x, LEG_Y), 128, 9.9, P, { slope: 0.05 }), { tone: "faint" }) });
}

// ---------------------------------------------------------------- torso shell (an anatomical torso with the front taken off)
const TRAY_Z = 177.5;
const FLOOR_Z = 184;
const TOP_Z = 300;
const ELL = { cx: 0, cy: -4, a: 42, b: 26 };
const ellipse = (a, b, t0, t1, n, cy = ELL.cy) => Array.from({ length: n + 1 }, (_, i) => {
  const t = ((t0 + ((t1 - t0) * i) / n) * Math.PI) / 180;
  return [a * Math.cos(t), cy + b * Math.sin(t)];
});
SYS = "frame";
extr("tray", ellipse(ELL.a, ELL.b, 0, 360, 72).slice(0, -1), TRAY_Z, FLOOR_Z - TRAY_Z, { tone: "mid" }, { bevel: 0.6 });
// the wall: an open U, the front cut away between t = 12° and 168°
const OPEN = [12, 168];
const outer = ellipse(ELL.a, ELL.b, OPEN[0], OPEN[1] - 360, 60);
const inner = ellipse(ELL.a - 4, ELL.b - 4, OPEN[1] - 360, OPEN[0], 60);
const WALL = [...outer, ...inner];
// ribs: raised bands moulded on the inside of the shell, from behind the spine round to the cut (or to where the face turns away)
// the shell is drawn as three pieces (left side, back, right side) so each one orders cleanly against the organs
const ribsBetween = (lo, hi) => {
  const out = [];
  const a = ELL.a - 4;
  const b = ELL.b - 4;
  const Vxy = [Math.cos((AZ * Math.PI) / 180), Math.sin((AZ * Math.PI) / 180)];
  for (let j = 0; j < 9; j++) {
    const zb = 230 + j * 7.6;
    for (const dz of [0, 2]) {
      let pts = [];
      const flush = () => { if (pts.length > 1) out.push(pts); pts = []; };
      for (let i = 0; i <= 120; i++) {
        const td = lo + ((hi - lo) * i) / 120;
        const t = (td * Math.PI) / 180;
        const n = [-Math.cos(t) / a, -Math.sin(t) / b];
        if ((n[0] * Vxy[0] + n[1] * Vxy[1]) / Math.hypot(...n) < 0.02) { flush(); continue; }
        const frac = Math.abs(td + 90) / 102;
        pts.push([a * Math.cos(t), ELL.cy + b * Math.sin(t), zb - 9 * frac + dz]);
      }
      flush();
    }
  }
  return out;
};
const ribSvg = (lists, cutAtStart) => lists.map((pts) => (cutAtStart ? k.fadeLineSvg(pts.map(at), { fade: [10, 0], tone: "lo" }) : Ln(path3(pts), { tone: "lo" }))).join("");
for (const [name, lo, hi, ref] of [["wall.left", OPEN[1] - 360, -140, [-36, -8, 240]], ["wall.back", -140, -40, [0, -26, 240]], ["wall.right", -40, OPEN[0], [36, -8, 240]]]) {
  const outerArc = ellipse(ELL.a, ELL.b, hi, lo, 30);
  const innerArc = ellipse(ELL.a - 4, ELL.b - 4, lo, hi, 30);
  extr(name, [...outerArc, ...innerArc], FLOOR_Z, TOP_Z - FLOOR_Z, { tone: "mid" }, { convex: false, ref, inner: Ln(k.ringSeam(outerArc, 230, P), { tone: "faint" }), extra: ribSvg(ribsBetween(lo, hi), name === "wall.left") });
}
// rim band on top of the wall and bolt dots
const rimLine = (a, b) => path3(ellipse(a, b, OPEN[0], OPEN[1] - 360, 60).map(([x, y]) => [x, y, TOP_Z]));
// shoulder yoke on top of the wall
const YOKE = { x: -58, y: -30, w: 116, d: 20, r: 5 };
SYS = "move";
slab("yoke", YOKE, TOP_Z, 7, { tone: "mid" }, { steps: 6, bevel: 0.6, extra: Dots([-52, -30, 30, 52].map((x) => at([x, -20, TOP_Z + 7])), { size: 0.45 }) });

// spine: thoracic and lumbar vertebrae inside the shell, cervical above the yoke
const SPINE = [0, -21];
const vert = (name, z0, h, r, pr) => {
  // a vertebral body with a transverse lug each side (drawn lug first, so the body covers its middle)
  const plan = { x: -pr, y: SPINE[1] - 1.2, w: pr * 2, d: 2.4, r: 1 };
  const F = vframe(...SPINE);
  const shapes = [record(A.slab(plan, z0 + 0.8, h - 1.6, { name: `${name}.lugs`, owner: name }, 2)), record(A.solid(F, [[z0, r], [z0 + h, r]], { name, owner: name }))];
  put(name, [SPINE[0], SPINE[1], z0 + h / 2], S(k.slabOf(plan, z0 + 0.8, h - 1.6, P, 2, 0.2), { tone: "mid" }) + S(G.solidOf([[z0, r], [z0 + h, r]], F, P), { tone: "mid" }), shapes, { bias: 0.02 });
};
for (let i = 0, z = FLOOR_Z; z < TOP_Z - 1; i++, z += 5.8) {
  vert(`spine.v${i}`, z, 4.4, 4.6, 7.4);
  if (z + 5.8 <= TOP_Z + 0.01) turned(`spine.d${i}`, vframe(...SPINE), [[z + 4.4, 3.9], [Math.min(TOP_Z, z + 5.8), 3.9]], { tone: "lo" });
}
const NECK_Z = TOP_Z + 7;
for (let i = 0; i < 4; i++) {
  const z = NECK_Z + i * 6;
  turned(`neck.v${i}`, vframe(...SPINE), [[z, 4], [z + 4.6, 4]], { tone: "mid" });
  turned(`neck.d${i}`, vframe(...SPINE), [[z + 4.6, 3.4], [z + 6, 3.4]], { tone: "lo" });
}
const HEAD_Z = NECK_Z + 24;

// ---------------------------------------------------------------- head and brain (the skull cap is off, resting on the plinth)
SYS = "brain";
const HEAD = [0, -8];
const HF = vframe(HEAD[0], HEAD[1], HEAD_Z);
const CUT = 39; // skull cut height above the chin
const skull = [[0, 0], [0, 15.5], [3, 16.4, 1], [9, 16.4, 1], [17, 19.6, 1], [25, 21.2, 1], [33, 21.6, 1], [CUT, 21.2]];
SYS = "move";
turned("skull", HF, skull, { tone: "mid" }, { inner: Ln(G.arcOf(HF, 20.5, 19.9, P, { slope: 0.3 }), { tone: "faint" }) });
// skull rim at the cut and the brain dome rising out of it
const brainR = (s) => 19.6 * Math.sqrt(Math.max(0, 1 - ((s - 36) / 15.2) ** 2));
const brainSlope = (s) => {
  const u = Math.min(0.999, (s - 36) / 15.2);
  return u <= 0 ? 0 : (-19.6 * u) / (15.2 * Math.sqrt(1 - u * u));
};
SYS = "brain";
const brainProfile = [[CUT, 19.6], ...Array.from({ length: 22 }, (_, i) => {
  const s = 36 + 15.199 * Math.sin((((i + 1) / 22) * Math.PI) / 2);
  return [s, brainR(s), 1];
})].filter((p, i, list) => i === 0 || p[0] > list[i - 1][0] + 0.01);
brainProfile[brainProfile.length - 1] = [36 + 15.2, 0];
// gyri: wavy lines drawn on the dome's surface, fading toward its outline; a midline fissure from front to back
const brainPoint = (s, th) => G.pointOf(HF, s, brainR(s), th);
const brainNormal = (s, th) => G.unit3(G.sub3(G.radialOf(HF, th), G.mul3(HF.a, brainSlope(Math.min(s, 51.1)))));
const surfaceLines = (samples) => {
  const out = [];
  for (let i = 1; i < samples.length; i++) {
    const [s0, t0] = samples[i - 1];
    const [s1, t1] = samples[i];
    const face = Math.min(G.dot3(brainNormal(s0, t0), V), G.dot3(brainNormal(s1, t1), V));
    const alpha = G.fadeOf(face, [0.12, 0.5]);
    if (alpha > 0.02) out.push({ d: path3([brainPoint(s0, t0), brainPoint(s1, t1)]), alpha });
  }
  return out;
};
const gyri = [];
for (let j = 0; j < 5; j++) {
  const base = CUT + 1.6 + j * 2.3;
  gyri.push(...surfaceLines(Array.from({ length: 181 }, (_, i) => { const th = (i / 180) * Math.PI * 2; return [base + 0.9 * Math.sin(7 * th + j * 1.7) + 0.4 * Math.sin(13 * th + j), th]; })));
}
const midline = [...surfaceLines(Array.from({ length: 41 }, (_, i) => [CUT + 0.2 + (51 - CUT - 0.2) * (i / 40), Math.PI / 2])), ...surfaceLines(Array.from({ length: 41 }, (_, i) => [CUT + 0.2 + (51 - CUT - 0.2) * (i / 40), -Math.PI / 2]))];
turned("brain", HF, brainProfile, { tone: "hi" }, { smooth: { slope: brainSlope }, extra: Faded(gyri, { tone: "lo" }) + Faded(midline, { tone: "mid" }), owner: "skull" });
// eyes, nose and ears on the face
SYS = "brain";
for (const side of [-1, 1]) {
  const eyeC = [HEAD[0] + side * 8, HEAD[1] + rimOn(20.2, 8) - 0.2, HEAD_Z + 23];
  const EF = G.frameAlong(eyeC, G.unit3([side * 0.38, 0.92, 0]));
  disc(`eye${side}`, EF, 0, 1.6, 4.4, { tone: "mid" }, { owner: "skull", extra: Ln(G.circleOf(EF, 1.6, 2.4, P), { tone: "mid" }) + Dots([at(G.pointOf(EF, 1.6, 0, 0))], { size: 0.9, tone: "hi" }) });
  const earC = [HEAD[0] + side * rimOn(21.2, 0) , HEAD[1] - 2, HEAD_Z + 20];
  disc(`ear${side}`, G.frameAlong([earC[0] - side * 0.4, earC[1], earC[2]], [side, 0, 0]), 0, 2, 4.8, { tone: "mid" }, { owner: "skull" });
}
SYS = "move";
const mouthC = [HEAD[0], HEAD[1] + rimOn(14.8, 0) - 0.6, HEAD_Z + 7.5];
put("mouth", mouthC, S(G.prismOf(G.frameAlong(mouthC, [0, 1, 0]), G.stadium(1.3, 1.3, 5.4), 0, 1.4, P), { tone: "lo" }), [record(A.prism(G.frameAlong(mouthC, [0, 1, 0]), G.stadium(1.3, 1.3, 5.4), 0, 1.4, { name: "mouth", owner: "skull" }))]);
const noseC = [HEAD[0], HEAD[1] + rimOn(19.4, 0) - 0.8, HEAD_Z + 15.5];
turned("nose", G.frameAlong(noseC, [0, 1, 0]), [[0, 3], [3.2, 1.4, 1], [3.8, 0]], { tone: "mid" }, { owner: "skull" });

// ---------------------------------------------------------------- arms
SYS = "move";
const SHOULDER_Z = TOP_Z - 6.5;
const ELBOW_Z = 238;
const ARM_X = 52;
const ELBOWS = {};
for (const side of [-1, 1]) {
  const x = side * ARM_X;
  const sh = ball(`shoulder${side}`, [x, -20, SHOULDER_Z], 6.5, { tone: "mid" });
  const el = ball(`elbow${side}`, [x, -20, ELBOW_Z], 5.5, { tone: "mid" });
  ELBOWS[side] = el;
  turned(`humerus${side}`, vframe(x, -20), [[ELBOW_Z + rimOn(5.5, 4), 4], [250, 3.3, 1], [272, 3.5, 1], [SHOULDER_Z - rimOn(6.5, 4.5), 4.5]], { tone: "mid" }, { cut: [sh, el] });
}
// left forearm hangs straight; the right one is live (built in the page)
{
  const x = -ARM_X;
  const wr = ball("wrist-1", [x, -20, 193], 3.4, { tone: "mid" });
  turned("forearm-1", vframe(x, -20), [[193 + rimOn(3.4, 3.2), 3.2], [212, 3.6, 1], [ELBOW_Z - rimOn(5.5, 4), 4]], { tone: "mid" }, { cut: [wr, ELBOWS[-1]] });
  turned("hand-1", vframe(x, -20), [[174, 2.4], [178, 3.6, 1], [186, 3.9, 1], [193 - rimOn(3.4, 2.8), 2.8]], { tone: "mid" }, { cut: [wr] });
}


// ---------------------------------------------------------------- breathing: trachea, bronchi, bellows lungs on two diaphragm domes
SYS = "lungs";
const LUNG_X = 24;
const LUNG_Y = -4;
const LUNG_R = 11;
const MANIFOLD_Z = 278; // fixed top plate of each lung
const DOME_RIM_Z = 238;
const DOME_R = 11;
const APEX_REST = 250; // dome apex when breathed out
const APEX_PER_L = 6; // the diaphragm comes down ≈ 3 cm per litre breathed in (6 units)
const PLEATS = 7;
const LUNG = { x: LUNG_X, y: LUNG_Y, r: LUNG_R, manifold: MANIFOLD_Z, rim: DOME_RIM_Z, domeR: DOME_R, apex: APEX_REST, perL: APEX_PER_L, pleats: PLEATS };
const domeProfile = (apex) => {
  const h = apex - DOME_RIM_Z;
  const out = [];
  for (let i = 0; i <= 14; i++) {
    const u = i / 14; // 0 at the rim, 1 at the apex
    const r = DOME_R * Math.cos((u * Math.PI) / 2);
    out.push([h * Math.sin((u * Math.PI) / 2), r, i > 0 && i < 14 ? 1 : 0]);
  }
  return out;
};
const domeSlope = (apex) => (s) => {
  const h = Math.max(0.5, apex - DOME_RIM_Z);
  const u = Math.min(0.999, Math.max(0, s / h));
  const t = Math.asin(u);
  return -(DOME_R * Math.sin(t)) / (h * Math.cos(t) + 1e-6) * (h / (h)) ;
};
const ARM = { elbow: [ARM_X, -20, 238], elbowR: 5.5, forearm: 42, insert: 9, origin: [ARM_X, -7.75, 289], muscleR: 4.2, rest: 0.17, top: 2.05 };
const LIVE_C = { lungX: LUNG_X, lungY: LUNG_Y, lungR: LUNG_R, manifold: MANIFOLD_Z, pleats: PLEATS, rim: DOME_RIM_Z, domeR: DOME_R, ...ARM, restLength: 1 };
let LIVE = makeLive(k, G, TB, P, LIVE_C);
LIVE_C.restLength = LIVE.arm(ARM.rest, 0).length;
LIVE = makeLive(k, G, TB, P, LIVE_C);
for (const side of [-1, 1]) {
  const x = side * LUNG_X;
  const LF = vframe(x, LUNG_Y);
  // the dome's fixed rim ring, held to the shell by two struts back to the wall
  SYS = "lungs move";
  turned(`dome${side}.rim`, LF, [[DOME_RIM_Z - 2, DOME_R + 1.4], [DOME_RIM_Z, DOME_R + 1.4]], { tone: "mid" }, { bevel: 0.3 });
  SYS = "lungs move";
  // the dome itself (rebuilt each frame in the page)
  const DF = vframe(x, LUNG_Y, DOME_RIM_Z);
  const dome = domeProfile(APEX_REST);
  put(`dome${side}`, [x, LUNG_Y, DOME_RIM_Z + 6], `<g data-part="dome${side}">${LIVE.dome(side, APEX_REST)}</g>`, [record(A.solid(DF, [[0, DOME_R], ...dome.slice(1)], { name: `dome${side}` }))], { bias: 0.05 });
  SYS = "lungs";
  // fixed manifold plate at the top: bronchus lands on top, pulmonary vessels on the inner side
  turned(`lung${side}.top`, LF, [[MANIFOLD_Z, LUNG_R + 0.8], [MANIFOLD_Z + 4, LUNG_R + 0.8]], { tone: "mid" }, { bevel: 0.4, extra: Dots(G.dotsOf(LF, MANIFOLD_Z + 4, LUNG_R - 0.4, 10, P, { all: true }), { size: 0.4, tone: "mid" }) });
  // bellows: a stack of alternating rings between a foot plate on the dome apex and the fixed manifold (rebuilt in the page)
  put(`lung${side}`, [x, LUNG_Y, 266], `<g data-part="bellows${side}">${LIVE.bellows(side, APEX_REST)}</g>`, [record(A.cylinder(x, LUNG_Y, LUNG_R, APEX_REST, MANIFOLD_Z - APEX_REST, { name: `lung${side}` }))]);
}
// airway: trachea down the front of the neck, a tee, a bronchus to each manifold
const TEE_AIR = [2, 3, 287];
SYS = "lungs";
const throat = [HEAD[0], HEAD[1] + 6, HEAD_Z + 0.2];
pipe("trachea", [[TEE_AIR[0], TEE_AIR[1], HEAD_Z], [TEE_AIR[0], TEE_AIR[1], TEE_AIR[2] + rimOn(3.6, 2.4)]], 2.4, "air", { flanges: [true, false], rings: { pitch: 2.2, fade: [0.1, 0.55] }, bend: 3 });
tee("trachea.tee", TEE_AIR, 3.6);
for (const side of [-1, 1]) {
  const x = side * LUNG_X;
  elbowed(`bronchus${side}`, [[TEE_AIR[0] + side * rimOn(3.6, 1.9), TEE_AIR[1], TEE_AIR[2]], [side * 11, TEE_AIR[1], TEE_AIR[2]], [x, LUNG_Y + 3, TEE_AIR[2] - 0.5], [x, LUNG_Y + 3, MANIFOLD_Z + 4]], 1.9, "air", [2], { flanges: [false, true], rings: { pitch: 2, fade: [0.1, 0.55] }, bend: 2.6 });
}

// ---------------------------------------------------------------- heart: a valve deck with four ports and a ventricle pump hung under it
SYS = "heart";
const HEART = [1, 8, 268];
const DECK_R = 11;
const VENT = [-2, 11];
const HEART_AXIS = G.unit3([-0.32, 0.42, -0.85]);
const HEART_LEN = 21;
turned("heart.deck", vframe(HEART[0], HEART[1]), [[HEART[2], DECK_R], [HEART[2] + 4, DECK_R]], { tone: "mid" }, { bevel: 0.4, extra: Dots(G.dotsOf(vframe(HEART[0], HEART[1]), HEART[2] + 4, DECK_R - 0.8, 14, P, { all: true }), { size: 0.38, tone: "mid" }) });
const VF = G.frameAlong([VENT[0], VENT[1], HEART[2]], HEART_AXIS);
const ventR = (s) => s <= 0 ? 6.4 : 6.4 + 4.2 * Math.sin(Math.min(1, s / 11) * Math.PI / 2) * (s < 11 ? 1 : Math.cos(((s - 11) / (HEART_LEN - 11)) * Math.PI / 2) ** 0.7);
const vent = Array.from({ length: 26 }, (_, i) => { const s = (HEART_LEN * i) / 25; return [s, i === 25 ? 0 : ventR(s), i > 0 && i < 25 ? 1 : 0]; });
const DECK = R.solids[R.solids.length - 1];
put("heart", G.add3(VF.o, G.mul3(HEART_AXIS, 9)), `<g data-part="heart">${S(G.lathe([[0, 0], ...vent], VF, P, { smooth: true }), { tone: "hi", inner: Ln(G.arcOf(VF, 9.5, ventR(9.5), P, { slope: 0.1 }), { tone: "faint" }) })}</g>`, [record(A.solid(VF, vent, { name: "heart", seated: true, cut: [DECK] }))], { bias: -0.1 });
// coronary artery on the pump's skin (a fine red line that follows the surface)
const DECK_TOP = HEART[2] + 4;
const port = (dx, dy) => [HEART[0] + dx, HEART[1] + dy, DECK_TOP];

// ---------------------------------------------------------------- vessels
SYS = "heart";
const AORTA = [-5.5, -11.5];
const IVC = [7, -11];
const BOTTOM_TEE = [AORTA[0], AORTA[1], 196];
// aorta: up out of the deck, arch back over the left bronchus, down in front of the spine to a tee in the pelvis
const ARCH_Z = 295.5;
const aorta = pipe("aorta", [[-4, 10, DECK_TOP], [-4, 10, 289], [-4.6, 3, ARCH_Z], [AORTA[0], AORTA[1], ARCH_Z], [AORTA[0], AORTA[1], 204], [BOTTOM_TEE[0], BOTTOM_TEE[1], BOTTOM_TEE[2] + rimOn(4, 2.8)]], 2.8, "art", {
  bend: 3.2, maxLength: 12, flanges: [true, false], caps: [true, false], flangeR: 1.3,
  tees: [{ name: "aorta.arch", near: [-4.8, -1.7, ARCH_Z], r: 3.4 }, { name: "aorta.renal", near: [AORTA[0], AORTA[1], 212.2], r: 3.8 }],
});
tee("aorta.split", BOTTOM_TEE, 4);
const ARCH = aorta.tees["aorta.arch"];
const RENAL_A = aorta.tees["aorta.renal"];
// carotid up into the head; subclavian along under the yoke to the right arm
pipe("carotid", [fromBall(ARCH, 3.4, 1.6, [0, 0, 1]), [ARCH[0], ARCH[1], HEAD_Z]], 1.6, "art", { flanges: [false, true], caps: [false, true], bend: 3 });
// iliac arteries: from the split down to ports in the pelvic floor (they carry on down the legs below the floor)
for (const side of [-1, 1]) {
  const dir = side < 0 ? [-1, 0, 0] : [0, 0, -1];
  const start = fromBall(BOTTOM_TEE, 4, 2.2, dir);
  const pts = side < 0 ? [start, [-14, BOTTOM_TEE[1], BOTTOM_TEE[2]], [-14, BOTTOM_TEE[1], FLOOR_Z]] : [start, [BOTTOM_TEE[0], BOTTOM_TEE[1], 187.4], [14, BOTTOM_TEE[1], 187.4], [14, BOTTOM_TEE[1], FLOOR_Z]];
  if (side < 0) elbowed(`iliac${side}`, pts, 2.2, "art", [1], { flanges: [false, true], caps: [false, true], bend: 2.6 });
  else pipe(`iliac${side}`, pts, 2.2, "art", { flanges: [false, true], caps: [false, true], bend: 2.6 });
}
// vena cava: from the pelvic floor up the right of the spine into the side of the heart deck
const ivc = elbowed("vena-cava", [[IVC[0], -5, FLOOR_Z], [IVC[0], -5, 190], [IVC[0], IVC[1], 198], [IVC[0], IVC[1], 256], [IVC[0], 3, 256], [IVC[0], 3, HEART[2]]], 3, "vein", [3, 4], { flangeR: 1.15,
  bend: 3, maxLength: 12, flanges: [true, false],
  tees: [{ name: "ivc.renal", near: [IVC[0], IVC[1], 208], r: 4 }, { name: "ivc.liver", near: [IVC[0], IVC[1], 228], r: 4 }],
});
const RENAL_V = ivc[0].tees["ivc.renal"];
const HEPATIC = ivc[0].tees["ivc.liver"];
// jugular / superior vena cava: from the head down the right of the neck into the deck top
pipe("jugular", [[8.5, -2, HEAD_Z], [8.5, -2, 303], [8.5, 11, 296], [5, 11, 284], [5, 11, DECK_TOP]], 2.2, "vein", { bend: 3 });
// the right arm: an anchor block under the yoke holds the top of the muscle; artery and motor nerve land on it
SYS = "move";
const ANCHOR = { x: ARM_X - 4, y: -10, w: 8, d: 4.5, r: 1 };
slab("anchor", ANCHOR, 289, 307 - 289, { tone: "mid" }, { steps: 3, bevel: 0.4, extra: Dots([at([ARM_X - 2.4, -5.5, 303]), at([ARM_X + 2.4, -5.5, 303]), at([ARM_X - 2.4, -5.5, 293.6]), at([ARM_X + 2.4, -5.5, 293.6])], { size: 0.4 }) });
turned("anchor.boss", vframe(ARM_X, -7.75), [[307, 1.6], [310, 1.6]], { tone: "mid" });
SYS = "heart";
SYS = "heart move";
pipe("brachial", [fromBall(ARCH, 3.4, 1.1, [1, 0, 0]), [30, ARCH[1], ARCH[2]], [36, 7, ARCH[2]], [ARM_X, 7, ARCH[2]], [ARM_X, -5.5, ARCH[2]]], 1.1, "art", { flanges: [false, true], caps: [false, true], bend: 3 });
// pulmonary arteries (blue: blood on its way to load oxygen) and veins (red: coming back loaded)
SYS = "heart lungs";
const PA_TEE = [0.5, 4, 276.5];
pipe("pulm-trunk", [[PA_TEE[0], PA_TEE[1], DECK_TOP], [PA_TEE[0], PA_TEE[1], PA_TEE[2] - rimOn(2.6, 1.8)]], 1.8, "vein", { flanges: [true, false], caps: [true, false] });
tee("pulm-trunk.tee", PA_TEE, 2.6);
for (const side of [-1, 1]) {
  const x = side * LUNG_X;
  const ix = x - side * (LUNG_R + 0.8);
  const RM = LUNG_R + 0.8;
  const onSide = (deg, z, out = 0) => { const a = (deg * Math.PI) / 180; return [x - side * (RM + out) * Math.cos(a), LUNG_Y + (RM + out) * Math.sin(a), z]; };
  pipe(`pulm-artery${side}`, [fromBall(PA_TEE, 2.6, 1.5, [side, 0, 0]), [PA_TEE[0] + side * 4.5, PA_TEE[1], PA_TEE[2]], onSide(18, MANIFOLD_Z + 2, 5), onSide(18, MANIFOLD_Z + 2)], 1.5, "vein", { bend: 2.6, flanges: [false, true], caps: [false, true], flangeR: 1.2 });
  elbowed(`pulm-vein${side}`, [onSide(40, MANIFOLD_Z + 2), onSide(40, MANIFOLD_Z + 2, 3.5), [HEART[0] + side * (DECK_R + 4), 8, HEART[2] + 2], [HEART[0] + side * DECK_R, 8, HEART[2] + 2]], 1.4, "art", [1, 2], { bend: 2.6, flangeR: 1.15 });
}

SYS = "heart gut";
// ---------------------------------------------------------------- digestion: esophagus, stomach, small and large intestine, liver
SYS = "gut";
const ST_A = [-5, -2, 229]; // the stomach's inlet (cardia)
const ST_B = [-21, 3, 214]; // its outlet (pylorus)
const ST_AXIS = G.unit3(G.sub3(ST_B, ST_A));
const ST_LEN = G.len3(G.sub3(ST_B, ST_A));
const SF = G.frameAlong(ST_A, ST_AXIS);
const stomachR = (s) => {
  const u = s / ST_LEN;
  return 2.6 + 5.6 * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.8 * (u < 0.87 ? 1 : 1);
};
const stomach = Array.from({ length: 24 }, (_, i) => { const s = (ST_LEN * i) / 23; return [s, Math.max(2.6, stomachR(s)), i > 0 && i < 23 ? 1 : 0]; });
turned("stomach", SF, stomach, { tone: "hi" }, { part: "stomach", extra: Faded(G.ribsOf(SF, 4, ST_LEN - 4, 9.5, 18, P, { fade: [0.15, 0.6], twist: 0.6 }).filter(() => false), { tone: "faint" }) });
pipe("esophagus", [[1, -6, HEAD_Z], [1, -6, 244], [ST_A[0] + 5.5, ST_A[1] - ST_AXIS[1] * 6, ST_A[2] - ST_AXIS[2] * 6], G.sub3(ST_A, G.mul3(ST_AXIS, 0.01))].map((p, i, l) => i === 2 ? G.sub3(ST_A, G.mul3(ST_AXIS, 6)) : p), 2, "gut", { bend: 3, rings: { pitch: 2.6, fade: [0.15, 0.6] }, flowVar: "food", flangeR: 1.2 });
// small intestine: a long folded tube in front of the lower belly
const SI_Y = 3.5;
const siRoute = [G.add3(ST_B, G.mul3(ST_AXIS, 0.01)), G.add3(ST_B, G.mul3(ST_AXIS, 3)), [-24, SI_Y, 210], [19, SI_Y, 210], [19, SI_Y, 200], [-19, SI_Y, 200], [-19, SI_Y, 190]];
const COLON_X = 29;
const COLON_Y = 4;
const CECUM = [COLON_X, SI_Y, 190];
pipe("small-intestine", [...siRoute, [CECUM[0] - rimOn(4.6, 2.2), SI_Y, CECUM[2]]], 2.2, "gut", { bend: 2.4, maxLength: 10, flowVar: "food", flanges: [true, false], caps: [true, false], flangeR: 1.15 });
ball("cecum", CECUM, 4.6, { tone: "mid" });
const colon = [[COLON_X, SI_Y, CECUM[2] + rimOn(4.6, 3.6)], [COLON_X, SI_Y, 216], [27, 14, 216], [-27, 14, 216], [-31, -1, 216], [-31, -1, FLOOR_Z]];
elbowed("colon", colon, 3.6, "gut", [1, 2, 3, 4], { bend: 2.6, maxLength: 12, rings: { pitch: 4.2, fade: [0.12, 0.55] }, flanges: [false, true], caps: [false, true], flowVar: "stool" });
// liver: a wedge under the right dome, with a gall bladder; the hepatic vein drains into the vena cava
const LIVER = [[14, -16], [28, -17], [36.4, -8], [32, 4], [14, 7]];
extr("liver", LIVER, 222, 14, { tone: "hi" }, { bevel: 0.6, inner: Ln(k.ringSeam(LIVER, 229, P), { tone: "faint" }) });
ball("gallbladder", [19, 5, 219.4], 2.6, { tone: "mid" });
SYS = "heart gut";
pipe("hepatic-vein", [fromBall(HEPATIC, 4, 1.5, [1, 0, 0]), [14, IVC[1], HEPATIC[2]]], 1.5, "vein", { flanges: [false, true], caps: [false, true] });

// ---------------------------------------------------------------- kidneys and bladder
SYS = "kidney";
const KID = { x: 24, y: -12, z0: 199, z1: 221 };
const kidR = (s) => 6.2 * Math.sqrt(Math.max(0, 1 - ((2 * s) / (KID.z1 - KID.z0) - 1) ** 2));
const kidney = Array.from({ length: 25 }, (_, i) => { const s = ((KID.z1 - KID.z0) * i) / 24; return [s, i === 0 || i === 24 ? 0 : kidR(s), i > 0 && i < 24 ? 1 : 0]; });
const BLADDER = [0, 15, FLOOR_Z];
const COLLAR = { r: 7, z1: FLOOR_Z + 4.5 };
for (const side of [-1, 1]) {
  const KF = vframe(side * KID.x, KID.y, KID.z0);
  turned(`kidney${side}`, KF, kidney, { tone: "hi" }, { inner: Ln(G.arcOf(KF, 11, kidR(11), P), { tone: "faint" }) });
  // the hilum: a flat boss on the kidney's inner side where the artery and vein connect (seated in the kidney)
  const KSH = R.solids[R.solids.length - 1];
  const HZ = 210;
  const hilumX = side * (KID.x - kidR(HZ - KID.z0) + 0.8);
  const HB = G.frameAlong([hilumX, KID.y, HZ], [-side, 0, 0]);
  turned(`kidney${side}.hilum`, HB, [[0, 3.8], [2.2, 3.8]], { tone: "mid" }, { cut: [KSH], owner: `kidney${side}` });
  const hface = hilumX - side * 2.2;
  SYS = "heart kidney";
  // renal artery and vein land on the hilum (the right artery passes in front of the vena cava, the left vein in front of the aorta)
  const hx = () => hface;
  const fromA = fromBall(RENAL_A, 3.8, 1.2, side < 0 ? [-1, 0, 0] : [0.6, 0.8, 0]);
  pipe(`renal-artery${side}`, side < 0 ? [fromA, G.add3(fromA, [-2.5, 0, 0]), [hx() + 4, KID.y + 1.6, RENAL_A[2]], [hx(), KID.y + 1.6, RENAL_A[2]]] : [fromA, G.add3(fromA, [3, 4, 0]), [12, -5, RENAL_A[2]], [hx() - 4, KID.y + 1.6, RENAL_A[2]], [hx(), KID.y + 1.6, RENAL_A[2]]], 1.2, "art", { flanges: [false, false], caps: [false, true], bend: 2.6 });
  const fromV = fromBall(RENAL_V, 4, 1.4, side > 0 ? [1, 0, 0] : [0, 1, 0]);
  (side < 0 ? (...a) => elbowed(a[0], a[1], a[2], a[3], [2, 3], a[4]) : pipe)(`renal-vein${side}`, side > 0 ? [fromV, G.add3(fromV, [2.5, 0, 0]), [hx() - 4, KID.y - 1, RENAL_V[2]], [hx(), KID.y - 1, RENAL_V[2]]] : [fromV, [IVC[0], -6.4, RENAL_V[2]], [-12, -6.4, RENAL_V[2]], [hx() + 4, KID.y - 1, RENAL_V[2]], [hx(), KID.y - 1, RENAL_V[2]]], 1.4, "vein", { flanges: [false, false], caps: [false, true], bend: 2.6 });
  SYS = "kidney";
  // ureter from the bottom of each kidney down and round to the side of the bladder's collar
  const toward = G.unit3([side * 16 - BLADDER[0], 2 - BLADDER[1], 0]);
  const end = [BLADDER[0] + toward[0] * COLLAR.r, BLADDER[1] + toward[1] * COLLAR.r, FLOOR_Z + 2.25];
  pipe(`ureter${side}`, [[side * KID.x, KID.y, KID.z0 + 0.284], [side * KID.x, KID.y, end[2]], [side * 16, 2, end[2]], end], 1, "urine", { bend: 3, flowVar: "urine", flangeR: 1.4 });
}
turned("bladder.collar", vframe(BLADDER[0], BLADDER[1]), [[FLOOR_Z, COLLAR.r], [COLLAR.z1, COLLAR.r]], { tone: "mid" }, { bevel: 0.3, extra: Dots(G.dotsOf(vframe(BLADDER[0], BLADDER[1]), COLLAR.z1, COLLAR.r - 1, 10, P, { all: true }), { size: 0.38, tone: "mid" }) });
const bladder = [[0, 6.6], [2.5, 7.1, 1], [5, 6.8, 1], [7.5, 5.3, 1], [9, 2.8, 1], [9.6, 0]];
const BF0 = vframe(BLADDER[0], BLADDER[1], COLLAR.z1);
put("bladder", [BLADDER[0], BLADDER[1], COLLAR.z1 + 4], `<g data-part="bladder">${S(G.lathe([[0, 0], ...bladder], BF0, P, { smooth: true }), { tone: "hi", inner: Ln(G.arcOf(BF0, 2.5, 7.1, P), { tone: "faint" }) })}</g>`, [record(A.solid(BF0, bladder, { name: "bladder" }))]);

// ---------------------------------------------------------------- nerves: spinal cord, a junction on the yoke, phrenic nerves to the domes, the motor nerve to the arm
SYS = "brain";
const JB = { x: -6.5, y: -17, w: 13, d: 6.5, r: 1.2 };
slab("junction", JB, TOP_Z + 7, 5, { tone: "mid" }, { steps: 3, bevel: 0.4, extra: Dots([at([JB.x + 2, JB.y + 2, TOP_Z + 12]), at([JB.x + JB.w - 2, JB.y + 2, TOP_Z + 12])], { size: 0.4 }) });
pipe("spinal-cord", [[0, -14.6, HEAD_Z], [0, -14.6, TOP_Z + 12]], 1, "nerve", { flanges: [true, true], flangeR: 1.6, flowVar: "cord" });
SYS = "brain move";
elbowed("motor-nerve", [[JB.x + JB.w, -15.5, TOP_Z + 8.2], [ARM_X, -15.5, TOP_Z + 8.2], [ARM_X, -7.75 - 1.6, TOP_Z + 8.2]], 0.7, "nerve", [1], { flanges: [false, false], flowVar: "arm", bend: 4 });
SYS = "brain lungs";
for (const side of [-1, 1]) {
  const x = side < 0 ? -7 : 5.4;
  pipe(`phrenic${side}`, [[side * (JB.w / 2), -12, TOP_Z + 10], [side * 11.5, -12, TOP_Z + 10], [side * 11.5, -7, TOP_Z + 6], [side * 11.5, -7, 250], [side * 12.5, -6.75, DOME_RIM_Z]], 0.7, "nerve", { flanges: [false, false], flowVar: side < 0 ? "phrL" : "phrR", bend: 4 });
}

const CSS = `
.iso{--art-body:#f4d9d7;--art-ink:#d23a40;--vein-body:#d9def3;--vein-ink:#3d5bc4;--gut-ink:#a0794c;--urine-ink:#b59a2c;--nerve-ink:#000}
.iso[data-theme="dark"]{--art-body:#3a2022;--art-ink:#ff6b6b;--vein-body:#1d2236;--vein-ink:#7aa2ff;--gut-ink:#c9a271;--urine-ink:#d9c25a;--nerve-ink:#fff}
.fl{fill:none;stroke-linecap:round;pointer-events:none;stroke-dashoffset:calc(var(--o) * 1px - var(--p, 0) * 1px)}
.fl[data-k="art"]{stroke:var(--art-ink);stroke-width:1.5;stroke-dasharray:.01 5.2;--p:var(--p-art)}
.fl[data-k="vein"]{stroke:var(--vein-ink);stroke-width:1.5;stroke-dasharray:.01 6.4;--p:var(--p-vein)}
.fl[data-k="air"]{display:none}
.fl[data-k="gut"]{stroke:var(--gut-ink);stroke-width:2.4;stroke-dasharray:.01 9;opacity:var(--food-o,0)}
.fl[data-k="urine"]{stroke:var(--urine-ink);stroke-width:1.2;stroke-dasharray:.01 5}
.fl[data-k="nerve"]{stroke:var(--nerve-ink);stroke-width:1.8;stroke-dasharray:8 4000}
.vs[data-k="art"] .tb-body{fill:var(--art-body)}
.vs[data-k="vein"] .tb-body{fill:var(--vein-body)}
.iso-svg{--p-cord:-200;--p-arm:-200;--p-phrL:-200;--p-phrR:-200}
.muscle[data-drive] .tb-body{fill:var(--anatomy-lit-shade)}
.muscle[data-drive] .tb-edge{stroke:var(--anatomy-lit)}
.iso{--dim-hi:#a9a9ad;--dim-mid:#c9c9cc;--dim-lo:#dddddf;--dim-shade:#f1f1ee;--dim-art:#e9b8b9;--dim-vein:#b9c3e6}
.iso[data-theme="dark"]{--dim-hi:#4a4a4a;--dim-mid:#333;--dim-lo:#262626;--dim-shade:#161616;--dim-art:#6a3436;--dim-vein:#33405f}
.iso-svg[data-focus] .it:not([data-on]){--anatomy-hi:var(--dim-hi);--anatomy-mid:var(--dim-mid);--anatomy-lo:var(--dim-lo);--anatomy-faint:var(--dim-lo);--anatomy-shade-0:var(--dim-shade);--anatomy-shade-1:var(--dim-shade);--anatomy-shade-2:var(--anatomy-paper);--anatomy-shade-3:var(--anatomy-paper);--art-ink:var(--dim-art);--vein-ink:var(--dim-vein);--art-body:var(--anatomy-paper);--vein-body:var(--anatomy-paper);--nerve-ink:var(--dim-hi)}
.iso-svg[data-focus] .it[data-on]{--anatomy-hi:var(--anatomy-lit);--anatomy-mid:var(--anatomy-hi)}
.it .iso-fill,.it .iso-shade,.it .iso-top,.it .iso-line,.it .tb-body{transition:fill .35s,stroke .35s}
.iso-stage .iso-svg{overflow:hidden}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.hb-controls{display:grid;gap:12px;margin:18px 0 0;font-family:var(--anatomy-mono);font-size:12px;color:var(--anatomy-text)}
.hb-effort{display:flex;align-items:center;gap:12px}
.hb-effort span{text-transform:uppercase;letter-spacing:.1em;color:var(--anatomy-muted)}
.hb-effort input{flex:1;accent-color:var(--anatomy-strong)}
.hb-effort b{min-width:5em;font-weight:500;color:var(--anatomy-strong)}
.hb-actions,.hb-systems{display:flex;flex-wrap:wrap;gap:6px}
.hb-controls button{font:inherit;color:var(--anatomy-strong);background:var(--anatomy-card);border:0;box-shadow:0 0 0 1px var(--anatomy-mid);padding:7px 11px;cursor:pointer}
.hb-controls button:hover{box-shadow:0 0 0 1px var(--anatomy-strong)}
.hb-systems button span{color:var(--anatomy-muted);margin-right:7px}
.hb-systems button[aria-pressed="true"]{background:var(--anatomy-strong);color:var(--anatomy-card)}
.hb-systems button[aria-pressed="true"] span{color:inherit;opacity:.6}
.hb-panel{margin:18px 0 40px;padding:18px 20px;box-shadow:0 0 0 1px var(--anatomy-mid);background:var(--anatomy-card);color:var(--anatomy-text);font-size:14px;line-height:1.6}
.hb-panel h2{margin:0 0 6px;font-size:13px;font-family:var(--anatomy-mono);text-transform:uppercase;letter-spacing:.1em;color:var(--anatomy-strong);font-weight:500}
.hb-panel p{margin:0 0 12px}
.hb-panel dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px 18px;margin:0;font-family:var(--anatomy-mono);font-size:12px}
.hb-panel dl div{display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--anatomy-faint);padding-top:5px}
.hb-panel dt{color:var(--anatomy-muted)}
.hb-panel dd{margin:0;color:var(--anatomy-strong);font-variant-numeric:tabular-nums;text-align:right}
`;
// ---------------------------------------------------------------- output
A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
// rim-on-sphere joints and parts seated in their host by design: each pair overlaps itself on screen at the joint
const JOINTS = [["shin*", "knee*"], ["shin*", "ankle*"], ["thigh*", "hip*"], ["thigh*", "knee*"], ["humerus*", "shoulder*"], ["humerus*", "elbow*"], ["forearm*", "elbow*"], ["forearm*", "wrist*"], ["hand*", "wrist*"], ["heart", "heart.deck"], ["skull", "eye*"], ["skull", "nose"], ["skull", "mouth"], ["skull", "ear*"], ["small-intestine*", "stomach"]];
// nerves laid along the top of the yoke, like cables clipped to a beam
const ON_YOKE = [["motor-nerve*", "yoke"], ["phrenic-1", "yoke"], ["phrenic1", "yoke"]];
// screen coincidences looked at in 4× close-ups: lines that pass 7–28 units apart in depth and only touch on screen,
// and the descending colon running in front of the left shell panel (a broad panel the check takes for a rod)
const SEEN = [["phrenic1", "jugular"], ["phrenic-1", "carotid"], ["pulm-artery1", "jugular"], ["bronchus1*", "jugular"], ["bronchus1*", "spine.*"], ["iliac*", "spine.*"], ["iliac*", "small-intestine"], ["renal-artery1", "colon*"], ["colon*", "wall.left"]];
A.auditOrExit(R, P, { allow: [...JOINTS, ["skull", "brain"], ["small-intestine*", "small-intestine.fl0"]], crowd: [...ON_YOKE, ...SEEN] });

const armSvg = `<g data-part="arm" data-sys="move" class="it">${LIVE.arm(ARM.rest, 0).svg}</g>`;
const items = R.items.map((item) => `<g class="it"${item.sys ? ` data-sys="${item.sys}"` : ""}${item.part ? ` data-part="${item.part}"` : ""}>${item.svg}</g>`).join("");


const SYSTEMS = [
  { id: "brain", title: "Brain and nerves", text: "The brain decides and the nerves carry its orders as electrical impulses. A motor nerve conducts at about 70 m/s, so the 0.95 m from the motor cortex to the biceps takes about 14 ms; the figure slows the impulse down so you can follow it. Breathing needs no decision: the brainstem fires the two phrenic nerves at the start of every breath, and each one pulls a dome of the diaphragm down." },
  { id: "heart", title: "Heart and blood", text: "The heart is two pumps side by side. The right side sends blue, oxygen-poor blood through the lungs; the left side sends red, oxygen-rich blood to everything else, and it comes back blue through the veins. Every beat pushes out a stroke volume, so cardiac output is heart rate × stroke volume. When muscles work, the heart beats faster, pushes more per beat at first, and the tissues pull more oxygen out of every litre." },
  { id: "lungs", title: "Lungs and breathing", text: "Lungs do not pull air in by themselves. The diaphragm is a muscle shaped like two domes; when it contracts the domes flatten and move down, the chest gets bigger, and air flows in down the trachea. At rest breathing out is passive: the diaphragm relaxes and the lungs spring back. In the alveoli oxygen moves into the blood and carbon dioxide moves out, so ventilation follows the CO₂ the muscles make." },
  { id: "gut", title: "Digestion", text: "Food goes down the oesophagus to the stomach, which churns it with acid and enzymes and lets it out a little at a time over 3–4 hours. The small intestine, about 6 m long, absorbs the sugars, amino acids and fats into the blood, and the blood from the gut passes through the liver first. The colon takes back water. After a meal blood glucose peaks in about 45 minutes and insulin brings it back down. Digestion runs 360 times faster here: one second is six minutes." },
  { id: "kidney", title: "Kidneys and bladder", text: "About a fifth of every heartbeat's blood goes through the kidneys. They filter about 125 mL of plasma a minute (180 L a day) and take back more than 99 % of it, keeping only what the body has too much of: urine. After a drink the kidneys take back less water, and urine flow rises from about 1 to about 9 mL/min within the hour. The bladder holds it until about 300–400 mL. Kidneys and bladder also run 360 times faster here." },
  { id: "move", title: "Muscles and bones", text: "Bones are the frame and the levers; joints are the pivots. Muscles can only pull: the biceps shortens and fattens, and because it is fixed to the forearm just past the elbow, a few centimetres of shortening swing the hand through a large arc. Working muscle burns oxygen, which is why everything else in the body speeds up when the arm works. The braided sleeve drawn here is an artificial muscle that behaves the same way: pressurised, it gets shorter and fatter." },
];
const OVERVIEW = "Every system in the body serves the same few needs: get oxygen and fuel to every cell, take carbon dioxide and waste away, and keep the inside steady while the outside changes. Set how hard the arm works and watch the heart, the lungs and the nerves answer it; eat or drink and watch the gut and the kidneys. Pick a system to light it.";
const DATA = {
  P,
  liveC: LIVE_C,
  lung: LUNG,
  up: k.axisVector(P, [0, 0, 1]),
  gauge: GAUGE,
  heartPivot: at([HEART[0], HEART[1], HEART[2]]),
  bladderPivot: at([BLADDER[0], BLADDER[1], COLLAR.z1]),
  stomachPivot: at(ST_A),
  lengths: Object.fromEntries([["cord", "spinal-cord"], ["arm", "motor-nerve"], ["phrL", "phrenic-1"], ["phrR", "phrenic1"]].map(([key, name]) => [key, ROUTES.filter((r) => r.name === name || r.name.startsWith(name + ".")).reduce((a, r) => a + r.screen, 0) + 8])),
  systems: SYSTEMS,
  overview: OVERVIEW,
  views: (() => {
    // the torso view keeps the card's aspect, so the card does not change size when it zooms
    const pts = [[0, -8, HEAD_Z + 52], [-58, -20, 307], [58, -20, 307], [-42, -4, TRAY_Z], [42, -4, TRAY_Z], [ARM_X, 30, 262], [ARM_X + 12, -10, 180], [-ARM_X, -20, 180], [0, 22, TRAY_Z]].map(at);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    let [x0, x1, y0, y1] = [Math.min(...xs) - 14, Math.max(...xs) + 14, Math.min(...ys) - 14, Math.max(...ys) + 14];
    let w = x1 - x0;
    let h = y1 - y0;
    if (w / h < W / H) { const nw = (h * W) / H; x0 -= (nw - w) / 2; w = nw; } else { const nh = (w * H) / W; y0 -= (nh - h) / 2; h = nh; }
    return { full: [0, 0, W, H], torso: [x0, y0, w, h].map((v) => Math.round(v * 100) / 100) };
  })(),
};
const count = (kind) => ROUTES.filter((r) => r.kind === kind).length;
console.log("routes", ROUTES.length, "arteries", count("art"), "veins", count("vein"), "nerves", count("nerve"));
const svg = k.figureSvg({
  width: W,
  height: H,
  label: "An anatomical automaton standing on a plinth, the front of its torso and the top of its skull taken off.",
  body: [...back, items, armSvg],
});
const body = k.plateHtml({
  fig: "Fig 1",
  title: "How a body works",
  hint: "Pick a system · ←/→ work",
  readout: `${Math.round(steady(0).hr)} bpm · ${Math.round(steady(0).rr)} breaths/min · ${steady(0).co.toFixed(1)} L/min`,
  keys: [
    { mark: "red", label: "Oxygen-rich blood (arteries, and pulmonary veins)" },
    { mark: "blue", label: "Oxygen-poor blood (veins, and pulmonary arteries)" },
    { mark: "lit", label: "The system you picked" },
  ],
  caption: "An anatomical automaton, 178 cm tall on a plinth, with the front of its torso and the top of its skull taken off. Its organs are machines that do what the real ones do: a two-sided pump, bellows pulled down by diaphragm domes, a gut line, filters and a tank, nerves that carry impulses, and a braided muscle that curls a dumbbell. Every number comes from one physiology model of a healthy 70 kg adult. Heartbeat and breathing run in real time; the body's response to work settles in seconds here (about a minute in life); nerve impulses are slowed down; digestion and the kidneys run 360 times faster.",
  body: `<style>${CSS}</style><div class="iso-stage" tabindex="0" role="group" aria-label="Human body figure. Left and right arrows set how hard the arm works, up and down pick a body system, 1 to 6 pick one directly, Space curls the arm, Escape shows the whole body.">${svg}</div>`,
});
const controls = `
<div class="hb-controls">
  <label class="hb-effort"><span>Work</span><input type="range" min="0" max="100" value="0" data-effort aria-label="How hard the arm works"><b data-effort-label>rest</b></label>
  <div class="hb-actions"><button type="button" data-curl>Curl once</button><button type="button" data-eat>Eat a meal</button><button type="button" data-drink>Drink 500 mL</button><button type="button" data-zoom aria-pressed="false">Zoom to the torso</button></div>
  <div class="hb-systems" role="toolbar" aria-label="Body systems">${SYSTEMS.map((sys, i) => `<button type="button" data-sys-button="${sys.id}" aria-pressed="false"><span>0${i + 1}</span>${sys.title}</button>`).join("")}</div>
</div>
<section class="hb-panel" data-panel aria-live="polite">
  <h2 data-title>The whole body</h2>
  <p data-text></p>
  <dl data-rows></dl>
</section>`;
const out = THEME === "light" ? "human-body.html" : "human-body-dark.html";
const SRC = (file) => readFileSync(join(SKILL, "kit", file), "utf8");
const wrap = (src, name) => {
  const names = [...src.matchAll(/^export (?:const|function|let) (\w+)/gm)].map((m) => m[1]);
  return `const ${name} = (() => {\n${src.replace(/^import .*$/gm, "").replace(/^export /gm, "")}\nreturn { ${names.join(", ")} };\n})();\n`;
};
const modelSrc = readFileSync(join(HERE, "model.mjs"), "utf8");
const MODEL = wrap(modelSrc, "MODEL") + `const { ${[...modelSrc.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]).join(", ")} } = MODEL;\n`;
const script = kitScript() + "\n" + wrap(SRC("lathe.mjs"), "G") + wrap(SRC("tube.mjs"), "TB") + MODEL + `const makeLive = ${LIVE_SRC};\nconst DATA = ${JSON.stringify(DATA)};\n` + readFileSync(join(HERE, "live.js"), "utf8");
writeFileSync(join(HERE, out), k.pageHtml({ title: "How a body works", theme: THEME, body: body + controls, script, width: 760 }));
console.log("wrote", out, R.items.length, "items");
