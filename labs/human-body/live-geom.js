(function makeLive(k, G, TB, P, C) {
  // Parts whose shape changes as the figure works. The build calls this for the rest pose; the page calls it every frame.
  const V = G.viewOf(P);
  const at = (p) => k.iso(p, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const rimOn = (R, a) => Math.sqrt(Math.max(0, R * R - a * a));

  // one diaphragm dome: rim fixed at C.rim, apex at `apex`
  function dome(side, apex) {
    const h = Math.max(0.6, apex - C.rim);
    const meridian = [[0, 0]];
    for (let i = 0; i <= 14; i++) {
      const u = i / 14;
      meridian.push([h * Math.sin((u * Math.PI) / 2), i === 14 ? 0 : C.domeR * Math.cos((u * Math.PI) / 2), i > 0 && i < 14 ? 1 : 0]);
    }
    const F = G.frameOf([side * C.lungX, C.lungY, C.rim], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
    return S(G.lathe(meridian, F, P, { smooth: true, steps: 40 }), { tone: "hi" });
  }

  // a lung: a foot plate on the dome apex and a stack of alternating rings up to the fixed manifold
  function bellows(side, apex) {
    const x = side * C.lungX;
    const out = [S(k.cylinder(x, C.lungY, C.lungR - 0.6, apex, 2, P, 48), { tone: "mid" })];
    const z0 = apex + 2;
    const n = C.pleats * 2;
    const h = (C.manifold - z0) / n;
    for (let i = 0; i < n; i++) out.push(S(k.cylinder(x, C.lungY, i % 2 ? C.lungR - 1.5 : C.lungR, z0 + i * h, h, P, 56), { tone: "hi", crease: i % 2 ? "faint" : "lo" }));
    return out.join("");
  }

  // the right forearm at elbow angle theta (0 = hanging, rising forward), the braided muscle that pulls it, and the dumbbell
  function arm(theta, drive) {
    const E = C.elbow;
    const d = [0, Math.sin(theta), -Math.cos(theta)];
    const n = [0, Math.cos(theta), Math.sin(theta)];
    const along = (s, off = 0) => G.add3(G.add3(E, G.mul3(d, s)), G.mul3(n, off));
    const parts = [];
    const push = (centre, svg) => parts.push({ key: G.dot3(centre, V), svg });
    // forearm bone from the elbow ball to the wrist
    const FF = G.frameOf(E, d, [1, 0, 0], n);
    const s0 = rimOn(C.elbowR, 4);
    push(along(20), S(G.solidOf([[s0, 4], [14, 3.9, 1], [30, 3.3, 1], [C.forearm, 2.9]], FF, P, { steps: 28 }), { tone: "mid" }));
    const wrist = along(C.forearm + rimOn(3.4, 2.9));
    push(wrist, S(G.sphereOf(wrist, 3.4, P, { steps: 28 }), { tone: "mid" }));
    // fist round the dumbbell handle; the handle lies along n (a hammer grip)
    const fistC = along(C.forearm + rimOn(3.4, 2.9) + 3.4 + 3.6);
    const HF = G.frameOf(fistC, n, [1, 0, 0], d);
    push(fistC, S(G.disc(-3.2, 3.2, 3.6, HF, P, { steps: 28, bevel: 0.2 }), { tone: "mid" }));
    for (const sign of [-1, 1]) {
      const a0 = sign * 3.2;
      const a1 = sign * 7.4;
      const handleC = G.add3(fistC, G.mul3(n, (a0 + a1) / 2));
      push(G.add3(handleC, G.mul3(V, -0.2)), S(G.disc(Math.min(a0, a1), Math.max(a0, a1), 1.5, HF, P, { steps: 18 }), { tone: "mid" }));
      const collar = sign * 8.1;
      push(G.add3(fistC, G.mul3(n, collar)), S(G.disc(Math.min(sign * 7.4, sign * 8.8), Math.max(sign * 7.4, sign * 8.8), 2.4, HF, P, { steps: 20 }), { tone: "mid" }));
      const plateC = G.add3(fistC, G.mul3(n, sign * 10.6));
      push(plateC, S(G.disc(Math.min(sign * 8.8, sign * 12.4), Math.max(sign * 8.8, sign * 12.4), 6.6, HF, P, { steps: 48, bevel: 0.3 }), { tone: "lo" }) + k.dotsSvg(G.dotsOf(HF, sign * 12.4, 1.6, 6, P, { all: true }), { size: 0.35, tone: "mid" }));
    }
    // insertion boss on the forearm, standing out along n
    const bossBase = along(C.insert, 3.7);
    const BF = G.frameOf(bossBase, n, [1, 0, 0], d);
    push(along(C.insert, 4.8), S(G.disc(0, 2.4, 1.7, BF, P, { steps: 16 }), { tone: "mid" }));
    const I = along(C.insert, 3.7 + 2.4 + 1.2); // ball-pin at the end of the boss
    push(I, S(G.sphereOf(I, 1.4, P, { steps: 20 }), { tone: "mid" }));
    // the muscle: a braided sleeve that fattens as it shortens (a McKibben actuator)
    const O = C.origin;
    const axis = G.unit3(G.sub3(I, O));
    const length = G.len3(G.sub3(I, O));
    const capT = 3;
    const top = G.add3(O, G.mul3(axis, capT));
    const bottom = G.sub3(I, G.mul3(axis, capT + rimOn(1.4, 1) ));
    const MF = G.frameAlong(O, axis);
    push(G.add3(O, G.mul3(axis, 1.5)), S(G.disc(0, capT, 2.6, MF, P, { steps: 24, bevel: 0.2 }), { tone: "mid" }));
    const MF2 = G.frameAlong(bottom, axis);
    push(G.add3(bottom, G.mul3(axis, 1.5)), S(G.disc(0, capT, 2.6, MF2, P, { steps: 24, bevel: 0.2 }), { tone: "mid" }));
    const belly = C.muscleR * Math.pow(C.restLength / length, 0.9);
    const route = Array.from({ length: 13 }, (_, i) => G.lerp3(top, bottom, i / 12));
    const radius = (t) => 2.4 + (belly - 2.4) * Math.pow(Math.sin(Math.PI * t), 0.55);
    const pieces = TB.tubePieces(route, radius, P, { maxLength: 400, spacing: 0.8, caps: [false, false], rings: { pitch: 2.4, twist: 1.1, cross: true, fade: [0.1, 0.6], tone: "lo" } });
    const lit = drive > 0.02;
    for (const piece of pieces) push(G.lerp3(top, bottom, 0.5), `<g class="muscle"${lit ? " data-drive" : ""}>${TB.tubeSvg(piece, { tone: "hi" })}</g>`);
    parts.sort((a, b) => a.key - b.key);
    return { svg: parts.map((p) => p.svg).join(""), length, belly, I };
  }

  return { dome, arm, bellows };
})
