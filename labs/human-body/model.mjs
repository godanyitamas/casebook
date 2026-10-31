// The physiology model behind the figure. Pure functions, no DOM. Every number the page shows comes from here.
// Values are typical for a healthy adult (~70 kg, ~35 years); sources in README.md.

export const BODY = {
  mass: 70, // kg
  height: 178, // cm (the figure is drawn at 2 world units per cm)
  hrRest: 62, // beats/min
  hrMax: 176, // peak heart rate in arm work, a little under the ≈ 185 of running
  svRest: 72, // mL per beat at rest, supine-ish standing ≈ 70
  svPeak: 95, // mL, stroke volume plateaus near 40–50 % of peak (lower in arm work than in running)
  vo2Rest: 250, // mL O2/min ≈ 3.5 mL/kg/min
  vo2Max: 2100, // mL O2/min: peak for arm work (arm cranking reaches ≈ 70 % of a leg VO2max of ≈ 3 L/min)
  rrRest: 12, // breaths/min
  rrMax: 40,
  deadSpace: 0.15, // L, anatomical dead space
  caO2: 200, // mL O2 per L of arterial blood (Hb 150 g/L × 1.34 × 0.98)
  gfr: 125, // mL/min glomerular filtration (≈ 180 L/day)
  bladderUrge: 300, // mL, first strong urge
  bladderMax: 500, // mL
  nerveSpeed: 70, // m/s, a myelinated motor axon (Aα 70–120)
  nervePath: 0.95, // m, motor cortex → spinal cord → biceps
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Effort e in [0, 1]: 0 is standing at rest, 1 is maximal work. VO2 scales linearly with work rate;
// heart rate rises close to linearly with VO2; stroke volume rises then plateaus; ventilation bends upward
// past the ventilatory threshold (~60 % VO2max) because extra CO2 from lactate buffering drives breathing.
export function steady(e) {
  const B = BODY;
  e = clamp(e, 0, 1);
  const vo2 = B.vo2Rest + e * (B.vo2Max - B.vo2Rest); // mL/min
  const share = (vo2 - B.vo2Rest) / (B.vo2Max - B.vo2Rest);
  const hr = B.hrRest + share * (B.hrMax - B.hrRest);
  const sv = B.svRest + (B.svPeak - B.svRest) * smooth(0, 0.5, share);
  const co = (hr * sv) / 1000; // L/min
  const avDiff = vo2 / co; // mL O2 per L of blood taken out by the tissues
  const cvO2 = B.caO2 - avDiff; // mL/L left in venous blood
  const rer = 0.8 + 0.3 * smooth(0.35, 1, share); // CO2 out / O2 in
  const vco2 = rer * vo2;
  const veq = 24 + 14 * smooth(0.6, 1, share) ** 1.5; // L of air per L of O2 (ventilatory equivalent)
  const ve = (veq * vo2) / 1000; // L/min
  const rr = B.rrRest + (B.rrMax - B.rrRest) * share ** 1.25;
  const vt = ve / rr; // L per breath
  const alveolar = (vt - B.deadSpace) * rr; // L/min that reaches the alveoli
  const muscleFlow = 0.2 + share * 0.5; // share of cardiac output going to skeletal muscle (≈ 20 % → 70 %)
  const gutFlow = 0.25 * (1 - 0.7 * share); // splanchnic share falls as muscles take the blood
  const kidneyFlow = 0.2 * (1 - 0.5 * share); // renal share falls too
  const brainFlow = 0.75 / co; // the brain keeps ≈ 0.75 L/min whatever happens
  const curlRate = share * 30; // dumbbell curls per minute, the work the arm does in the figure
  return { e, vo2, hr, sv, co, avDiff, caO2: B.caO2, cvO2, satV: cvO2 / B.caO2, rer, vco2, ve, rr, vt, alveolar, muscleFlow, gutFlow, kidneyFlow, brainFlow, curlRate };
}

// One heartbeat: a pressure-like envelope in [0, 1] over the cardiac cycle. Systole takes ≈ 0.3 s and
// shortens only a little with rate; diastole takes the rest, so at high rates the beat is mostly systole.
export function beat(phaseSeconds, hr) {
  const period = 60 / hr;
  const systole = Math.min(0.3, period * 0.45) * (1 - 0.15 * clamp((hr - 60) / 120, 0, 1));
  const t = ((phaseSeconds % period) + period) % period;
  if (t < systole) return Math.sin((Math.PI * t) / systole) ** 2 * (t < systole / 2 ? 1 : 1);
  return 0;
}
export const systoleOf = (hr) => Math.min(0.3, (60 / hr) * 0.45) * (1 - 0.15 * clamp((hr - 60) / 120, 0, 1));

// Lung volume above functional residual capacity, in L, over one breath: inhale ~40 %, exhale ~60 % at rest,
// closer to 50/50 when breathing hard.
export function breath(phaseSeconds, rr, vt) {
  const period = 60 / rr;
  const t = ((phaseSeconds % period) + period) % period / period;
  const inhale = 0.4 + 0.08 * clamp((rr - 12) / 30, 0, 1);
  const x = t < inhale ? t / inhale : 1 - (t - inhale) / (1 - inhale);
  return vt * (0.5 - 0.5 * Math.cos(Math.PI * clamp(x, 0, 1)));
}

// Digestion in hours (the figure runs it in time-lapse). A mixed meal leaves the stomach over ≈ 3–4 h,
// crosses the small intestine in ≈ 3–5 h and spends 1–2 days in the colon. Blood glucose peaks ≈ 45 min
// after eating and insulin returns it to baseline in ≈ 2–3 h.
export const GUT = { stomachHalf: 1.6, smallTransit: 4, glucoseBase: 5.0, glucosePeak: 7.6, glucosePeakAt: 0.75, glucoseBack: 2.6 };
export function meal(hoursSince) {
  const h = Math.max(0, hoursSince);
  const stomach = Math.exp((-Math.LN2 * h) / GUT.stomachHalf); // share still in the stomach
  const emptied = 1 - stomach;
  const intestine = Math.max(0, emptied - smooth(GUT.smallTransit * 0.6, GUT.smallTransit * 1.6, h)); // share in the small intestine
  const k = h / GUT.glucosePeakAt;
  const rise = h <= 0 ? 0 : k * Math.exp(1 - k); // gamma-like curve, 1 at the peak
  const glucose = GUT.glucoseBase + (GUT.glucosePeak - GUT.glucoseBase) * rise;
  const insulin = 6 + 54 * (h <= 0 ? 0 : ((h / 0.9) * Math.exp(1 - h / 0.9))); // mU/L, lags glucose
  return { stomach, intestine, glucose, insulin };
}

// Kidneys: filtration is steady; what changes is how much water is taken back. After 500 mL of water,
// urine flow rises from ≈ 1 to ≈ 8–10 mL/min within ≈ 40 min and returns over ≈ 2 h.
export function urineFlow(hoursSinceDrink) {
  const h = hoursSinceDrink;
  if (!(h >= 0)) return 1;
  const k = h / 0.75;
  return 1 + 8 * k * Math.exp(1 - k);
}
export const reabsorbed = (urine) => 1 - urine / BODY.gfr; // share of the filtrate taken back

export const nerveDelay = () => BODY.nervePath / BODY.nerveSpeed; // seconds, ≈ 14 ms
