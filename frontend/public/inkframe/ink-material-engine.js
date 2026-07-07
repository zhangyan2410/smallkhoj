/* eslint-disable */
/*
 * ink-material-engine.js
 *
 * A WebGL2 fluid-simulation ink engine, packaged as a program-drivable
 * material substrate for an AI collaboration workbench.
 *
 * This is an original re-implementation inspired by John O. Whitaker's
 * "inkwash" (https://github.com/johnowhitaker/inkwash), a single-file
 * pen-and-ink WebGL2 drawing app. The inkwash source was studied to learn the
 * fluid + material relationships; none of its source text is copied verbatim.
 * The shaders, plumbing, and the surface/preset/state API below are written
 * from scratch for the Inkframe product context.
 *
 * Reference model preserved here (see inkwash-reference-logic.md):
 *   - brush creates water + velocity; never ink by default
 *   - water gates movement: mobile ink moves only where wetness passes a
 *     mobility threshold
 *   - fixed ink does not lift by default (re-wetting is opt-in, off by default
 *     because it haloed fresh strokes in the reference)
 *   - display is half the effect: paper fiber/tooth, absorption-based ink
 *     rendering, edge enhancement, wet-paper darkening
 *   - pressure projection is what makes water feel ALIVE instead of stamped
 *
 * Core pipeline (every frame):
 *   1. input splats (pen / brush / fix) write into live fields
 *   2. velocity: self-advect + damp, confined to wet mask
 *   3. curl + vorticity confinement -> swirl energy
 *   4. divergence -> pressure Jacobi (N iters) -> gradient subtraction
 *   5. wetness: advected by velocity, local creep, evaporates
 *   6. mobile ink: advected + bleeds ONLY where wetness passes mobility curve
 *   7. settle/fix: mobile ink bakes into fixed ink on explicit fix
 *   8. display: absorption + grain + edge + wet darkening
 *
 * Public API:
 *   window.InkMaterial.create(canvas, options) -> InkMaterialSurface
 *
 *   surface.setState({ state, preset, seed })      runtime material language
 *   surface.setPreset("reference"|"productDryPen"|"demoVisible")
 *   surface.setSeed(seedString)
 *   surface.pen({ x, y, pressure, speed })         x,y in normalized 0..1 (y up)
 *   surface.brush({ x, y, pressure, speed, vx, vy })
 *   surface.stroke([{x,y,pressure,speed}], {tool:"pen"|"brush"})
 *   surface.inject({ kind, x, y, radius, strength, vx, vy })
 *   surface.injectInk(mark)  / surface.injectWater(mark) / surface.fix(strength)
 *   surface.seedMarks(kind, count)
 *   surface.clear()
 *   surface.pause() / surface.resume()
 *   surface.setQuality("low"|"medium"|"high")      sim resolution + iters
 *   surface.getState()
 *
 * Coordinates are normalized [0,1] with origin bottom-left (y up), which
 * matches the internal simulation grid. The surface handles aspect correction.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Field description (for documentation; the engine is single-ink-channel).
  //   velocity : 2-channel RG16F flow field
  //   wet      : 1-channel R16F scalar (water amount)
  //   ink      : 1-channel R16F mobile pigment (we keep monochrome ink only,
  //              product UI does not need the reference's chromatic bleed)
  //   fixed    : 1-channel R16F baked pigment
  //   curl/divergence/pressure : solver scratch (NEAREST sampling)
  // ---------------------------------------------------------------------------

  const QUALITY = {
    low:    { simBase: 160, dyeBase: 512,  pressureIter: 14, velocityDamp: 3.2, curlBoost: 14 },
    medium: { simBase: 224, dyeBase: 1024, pressureIter: 22, velocityDamp: 3.0, curlBoost: 18 },
    high:   { simBase: 288, dyeBase: 1536, pressureIter: 30, velocityDamp: 3.0, curlBoost: 22 }
  };

  const DEFAULT_QUALITY = "medium";
  const smoothstep = (edge0, edge1, x) => {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };

  // ---------------------------------------------------------------------------
  // Tunable parameters (the inkwash "sliders", packaged so an agent or UI can
  // adjust the feel in real time). Each surface holds its own copy so different
  // surfaces can feel different. setParams({size, flow, ...}) merges partial
  // updates. These map 1:1 to the reference's SIZE/FLOW/BLEED/DRY/COLOR/BINK,
  // plus ink (pigment amount) and penWet for product control.
  //   size     0..1   global radius multiplier (0.33x .. 3x), like inkwash SIZE
  //   flow     0..1   water/velocity force + vorticity energy + velocity damping
  //   bleed    0..1   mobile-ink neighbor bleed amount (how far pigment spreads)
  //   dry      0..1   wetness evaporation timescale (high = dries fast)
  //   ink      0..1   pen pigment amount multiplier (how dark the ink lays down)
  //   penWet   0..1   how much wetness the pen writes (0 = dry pen, ref ~0.16)
  //   brushInk 0..1   optional pigment carried by the water brush (ref default 0)
  //   swirl    0..1   dwell-stir strength: how hard a still brush churns the
  //                   water (develops curl -> vorticity spins it). 0 = no stir.
  //   vortex   0..1   vorticity-confinement multiplier (how much small swirls
  //                   get amplified into visible rotation). 1 = inkwash default.
  //   color    0..1   ink cool/warm tint (kept for parity; minor effect here)
  const DEFAULT_PARAMS = {
    size: 0.5, flow: 0.6, bleed: 0.5, dry: 0.45,
    ink: 0.8, penWet: 0.16, brushInk: 0.0, swirl: 0.6, vortex: 1.0, color: 0.5
  };
  // Named feels an agent can apply with setParams("bold"|"fine"|...).
  // The first group sizes the pen; the WATER_STYLES group below sizes the
  // water's *character* (swirl/vortex/flow/dry) and is the user-facing way to
  // switch between "旋转/静水/水洗/飞溅/露珠" water feelings.
  const PARAM_PRESETS = {
    default:   { size: 0.5, flow: 0.6, bleed: 0.5, dry: 0.45, ink: 0.8, penWet: 0.16, brushInk: 0.0, swirl: 0.6, vortex: 1.0 },
    bold:      { size: 0.78, flow: 0.6, bleed: 0.55, dry: 0.45, ink: 1.0, penWet: 0.16, brushInk: 0.0, swirl: 0.6, vortex: 1.0 },
    fine:      { size: 0.25, flow: 0.55, bleed: 0.4, dry: 0.5, ink: 0.7, penWet: 0.1, brushInk: 0.0, swirl: 0.5, vortex: 0.9 },
    watery:    { size: 0.5, flow: 0.85, bleed: 0.7, dry: 0.3, ink: 0.7, penWet: 0.16, brushInk: 0.0, swirl: 0.6, vortex: 1.0 },
    drypen:    { size: 0.5, flow: 0.6, bleed: 0.45, dry: 0.6, ink: 0.9, penWet: 0.0, brushInk: 0.0, swirl: 0.6, vortex: 1.0 }
  };

  // WATER_STYLES — distinct water *characters*. These are the user-facing way
  // to switch the feel of water itself (independent of pen size/ink). Each is a
  // partial param patch; setParams("swirl") etc. applies it. A surface can also
  // be told its water style at construction via options.waterStyle.
  //   swirl  : 旋转 — inkwash reference feel. Strong dwell stir + full vorticity
  //            confinement, so water visibly spins and carries ink in arcs.
  //   still  : 静水 — the "water barely moves" feel. Low flow, no dwell stir,
  //            fast dry. Water wets paper but does not churn. (This is the
  //            restrained look; what an earlier wrong version produced.)
  //   wash   : 水洗 — large slow flood. High flow + bleed, slow dry, low vortex
  //            so it spreads flat instead of spinning. Good for soft washes.
  //   splash : 飞溅 — short sharp jets. High vortex + strong swirl, fast dry,
  //            smaller radius. Water kicks and dissipates quickly.
  //   dew    : 露珠 — tiny beads. Minimal flow, almost no bleed or vortex;
  //            water stays as small wet spots that barely grow.
  const WATER_STYLES = {
    swirl:  { flow: 0.62, dry: 0.45, bleed: 0.5,  swirl: 0.85, vortex: 1.25 },
    still:  { flow: 0.28, dry: 0.7,  bleed: 0.35, swirl: 0.0,  vortex: 0.5 },
    wash:   { flow: 0.9,  dry: 0.25, bleed: 0.8,  swirl: 0.35, vortex: 0.6 },
    splash: { flow: 0.7,  dry: 0.6,  bleed: 0.45, swirl: 1.0,  vortex: 1.5 },
    dew:    { flow: 0.18, dry: 0.5,  bleed: 0.15, swirl: 0.1,  vortex: 0.4 }
  };


  // Material state language: runtime states -> material + behavior.
  // dryPaperOnly shows clean paper, no idle pigment; everything else seeds
  // gentle marks proportional to how "active" the runtime is.
  const STATES = {
    idle:      { wet: 0.00, flow: 0.04, ink: 0.00, dry: 0.55, fix: false, paperOnly: true,  label: "干纸待命" },
    think:     { wet: 0.10, flow: 0.20, ink: 0.08, dry: 0.70, fix: false, paperOnly: false, label: "酝酿" },
    running:   { wet: 0.42, flow: 0.60, ink: 0.26, dry: 0.50, fix: false, paperOnly: false, label: "运行中" },
    review:    { wet: 0.20, flow: 0.22, ink: 0.20, dry: 0.62, fix: false, paperOnly: false, label: "待审阅" },
    done:      { wet: 0.05, flow: 0.05, ink: 0.16, dry: 0.90, fix: true,  paperOnly: false, label: "已固化" },
    blocked:   { wet: 0.26, flow: 0.16, ink: 0.52, dry: 0.45, fix: false, paperOnly: false, label: "阻塞" }
  };

  // Presets encode the reference ratio model explicitly. Do NOT hide demo
  // exaggeration inside the core constants.
  const PRESETS = {
    reference: {
      penWet: 0.16,      // fresh ink is faintly wet
      brushInk: 0.0,     // clean water by default
      fixedLift: 0.0,    // lift is gated to renderMode==="live" in _step (方案A)
      inkMobilityLow: 0.02, inkMobilityHigh: 0.45,
      bleed: 0.5
    },
    productDryPen: {
      penWet: 0.0,       // 墨笔 has no water for clear tool semantics
      brushInk: 0.0,
      fixedLift: 0.0,    // product surfaces keep fixed ink permanent
      inkMobilityLow: 0.02, inkMobilityHigh: 0.45,
      bleed: 0.5
    },
    demoVisible: {
      penWet: 0.0,       // pen writes fresh no-water mobile ink for clear demos
      brushInk: 0.0,
      fixedLift: 0.0,    // still off; visibility comes from fresh mobile ink
      inkMobilityLow: 0.02, inkMobilityHigh: 0.48,
      bleed: 0.6
    }
  };

  const DEFAULT_STATE = "idle";
  const DEFAULT_PRESET = "reference";

  // ---------------------------------------------------------------------------
  // GLSL source. Written fresh; the algorithms (semi-Lagrangian advection,
  // vorticity confinement, Jacobi pressure projection) are standard fluid-sim
  // techniques and the absorption display follows the inkwash conceptual model.
  // ---------------------------------------------------------------------------

  const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  // copy src texture scaled by uValue (used for resize-preserving field copy)
  const COPY_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform float uValue;
void main(){ o = texture(uTex, vUv) * uValue; }`;

  // additive splat: gaussian footprint scaled by uColor. Accumulation is done
  // entirely via GL blend state (the shader outputs the gaussian only; it does
  // NOT sample the field it writes to, which would be a feedback loop). This
  // mirrors how the inkwash reference splats work.
  const SPLAT_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform float uAspect; uniform vec2 uPoint; uniform vec4 uColor; uniform float uRadius;
void main(){
  vec2 p = vUv - uPoint; p.x *= uAspect;
  float g = exp(-dot(p, p) / max(uRadius * uRadius, 1e-7));
  o = uColor * g;
}`;

  // velocity: semi-Lagrangian self-advect + damp, masked by wetness so dry
  // paper does not keep moving. Strong extra damping while fixing.
  const ADVECT_VEL_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity, uWet;
uniform vec2 uTexel; uniform float uDt, uDissipation;
void main(){
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 coord = vUv - uDt * vel * uTexel;
  vel = texture(uVelocity, coord).xy * uDissipation;
  float w = texture(uWet, vUv).x;
  float mask = smoothstep(0.005, 0.2, w);
  o = vec4(vel * mask, 0.0, 1.0);
}`;

  // curl: scalar vorticity of the velocity field
  const CURL_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity; uniform vec2 uTexel;
void main(){
  float L = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;
  float R = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;
  float B = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).x;
  o = vec4(0.5 * ((R - L) - (T - B)), 0.0, 0.0, 1.0);
}`;

  // vorticity confinement: add swirl energy back based on curl gradient
  const VORTICITY_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity, uCurl; uniform vec2 uTexel;
uniform float uCurlAmt, uDt;
void main(){
  float L = texture(uCurl, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uCurl, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uCurl, vUv + vec2(0.0, uTexel.y)).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 1e-4;
  force *= uCurlAmt * C * vec2(1.0, -1.0);
  vec2 vel = texture(uVelocity, vUv).xy + force * uDt;
  o = vec4(clamp(vel, -1000.0, 1000.0), 0.0, 1.0);
}`;

  const DIVERGENCE_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity; uniform vec2 uTexel;
void main(){
  float L = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
  float T = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

  // one Jacobi pressure iteration
  const PRESSURE_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uPressure, uDivergence; uniform vec2 uTexel;
void main(){
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float div = texture(uDivergence, vUv).x;
  o = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}`;

  // subtract pressure gradient from velocity (projection)
  const GRAD_SUB_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uPressure, uVelocity; uniform vec2 uTexel;
void main(){
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  vec2 vel = texture(uVelocity, vUv).xy - 0.5 * vec2(R - L, T - B);
  o = vec4(vel, 0.0, 1.0);
}`;

  // wetness: advected by velocity, local neighbor creep, exponential decay.
  const ADVECT_WET_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity, uWet;
uniform vec2 uTexel, uSrcTexel; uniform float uDt, uDecay, uSpread;
void main(){
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 coord = vUv - uDt * vel * uTexel * 0.6;
  float w = texture(uWet, coord).x;
  vec2 b = uSrcTexel * 1.6;
  float n = (texture(uWet, coord + vec2(b.x, 0.0)).x
           + texture(uWet, coord - vec2(b.x, 0.0)).x
           + texture(uWet, coord + vec2(0.0, b.y)).x
           + texture(uWet, coord - vec2(0.0, b.y)).x) * 0.25;
  w = mix(w, n, uSpread);
  o = vec4(w * uDecay, 0.0, 0.0, 1.0);
}`;

  // mobile ink: advected by velocity + 4-neighbor bleed, ONLY where wetness
  // passes the mobility curve. This follows the inkwash reference advectInk
  // exactly: bleed = uBleed * (0.25 + 1.3*brush) * mob (no extra flow gate).
  // Brush footprint boosts bleed locally. uBrush.z<=0 = inactive.
  const ADVECT_INK_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity, uInk, uWet;
uniform vec2 uTexel, uSrcTexel; uniform float uDt, uBleed, uAspect;
uniform vec2 uMobLowHigh; uniform vec3 uBrush;
void main(){
  float w = texture(uWet, vUv).x;
  float mob = smoothstep(uMobLowHigh.x, uMobLowHigh.y, w);
  float cur = texture(uInk, vUv).x;
  if (mob < 0.002){ o = vec4(cur, 0.0, 0.0, 1.0); return; }
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 coord = vUv - uDt * vel * uTexel * mob;
  float adv = texture(uInk, coord).x;
  float brush = 0.0;
  if (uBrush.z > 0.0){
    vec2 d = vUv - uBrush.xy; d.x *= uAspect;
    brush = exp(-dot(d, d) / (uBrush.z * uBrush.z));
  }
  vec2 b = uSrcTexel * 1.6;
  float n = (texture(uInk, coord + vec2(b.x, 0.0)).x
           + texture(uInk, coord - vec2(b.x, 0.0)).x
           + texture(uInk, coord + vec2(0.0, b.y)).x
           + texture(uInk, coord - vec2(0.0, b.y)).x) * 0.25;
  float bleedAmt = clamp(uBleed * (0.25 + 1.3 * brush) * mob, 0.0, 0.92);
  float moved = mix(adv, n, bleedAmt);
  o = vec4(mix(cur, moved, mob), 0.0, 0.0, 1.0);
}`;

  // exchange pass: settle mobile ink into fixed ink (mode 0 writes fixed,
  // mode 1 writes mobile). Re-wet lift is opt-in and off by default.
  const EXCHANGE_FIXED_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uFixed, uInk, uWet; uniform float uSettle, uLift, uDt;
void main(){
  float F = texture(uFixed, vUv).x;
  float M = texture(uInk, vUv).x;
  float w = clamp(texture(uWet, vUv).x, 0.0, 1.0);
  float lift = clamp(w * uLift * uDt, 0.0, 0.25);
  float fd = F * (1.0 - lift) + M * uSettle;
  o = vec4(clamp(fd, 0.0, 4.0), 0.0, 0.0, 1.0);
}`;

  const EXCHANGE_MOBILE_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uFixed, uInk, uWet; uniform float uSettle, uLift, uDt;
void main(){
  float F = texture(uFixed, vUv).x;
  float M = texture(uInk, vUv).x;
  float w = clamp(texture(uWet, vUv).x, 0.0, 1.0);
  float lift = clamp(w * uLift * uDt, 0.0, 0.25);
  float md = M * (1.0 - uSettle) + F * lift;
  o = vec4(clamp(md, 0.0, 4.0), 0.0, 0.0, 1.0);
}`;

  // display: paper fiber/tooth + absorption rendering + edge enhancement +
  // wet-paper darkening + vignette. uPaperOnly fades ink toward clean paper.
  const DISPLAY_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uInk, uFixed, uWet;
uniform vec3 uPaperTint;
uniform vec2 uTexel, uRes;
uniform float uInkStrength, uEdge, uGrain, uPaperFade, uTime, uSeed, uVignette;
uniform bool uCleanPaper;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21) + uSeed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.07; a *= 0.5; } return v; }
float pigment(vec2 uv){ return texture(uInk, uv).x + texture(uFixed, uv).x; }
void main(){
  vec2 px = vUv * uRes;
  float fiber = fbm(px * 0.055);
  float tooth = vnoise(px * 0.42);
  float grain = fbm(px * 0.12 + 31.7 + uSeed);
  vec3 paper = uPaperTint;
  if (!uCleanPaper) {
    paper -= (fiber - 0.5) * 0.05;
    paper -= (tooth - 0.5) * 0.022;
  }

  float dens = pigment(vUv);
  float l = pigment(vUv - vec2(uTexel.x, 0.0));
  float r = pigment(vUv + vec2(uTexel.x, 0.0));
  float b = pigment(vUv - vec2(0.0, uTexel.y));
  float t = pigment(vUv + vec2(0.0, uTexel.y));
  float edge = length(vec2(r - l, t - b));

  float absorbed = dens * uInkStrength;
  absorbed *= 1.0 + (grain - 0.5) * uGrain * clamp(dens * 2.0, 0.0, 1.0);
  absorbed *= 1.0 + edge * uEdge;
  // paper-fade toward clean paper (used for idle "干纸待命")
  absorbed *= 1.0 - uPaperFade;
  // ink is near-neutral cool (松烟墨). exp(-absorption) = paper darkened by ink.
  vec3 inkTint = vec3(1.0, 0.965, 0.875);
  vec3 col = paper * exp(-absorbed * inkTint);

  if (!uCleanPaper) {
    // wet paper darkens slightly and cools
    float wraw = texture(uWet, vUv).x;
    float ws = smoothstep(0.02, 0.6, wraw) * (1.0 - uPaperFade);
    col *= vec3(1.0) - ws * vec3(0.16, 0.15, 0.11);

    // gentle vignette
    vec2 q = vUv - 0.5;
    col *= 1.0 - dot(q, q) * uVignette;
  }
  o = vec4(col, 1.0);
}`;

  // inkify display: takes an EXTERNAL RGBA image (a rasterized SVG / any art)
  // as uSource and renders it as a handcraft ink-on-rice-paper drawing. This is
  // path B (post-process): the SVG's structure is drawn normally first, then
  // the engine's paper + ink material treatment is layered on top.
  //
  // Treatment applied:
  //   - paper fiber/tooth/grain shows through light/transparent areas
  //   - the source image is treated as ink: darkness/opacity drives an
  //     absorption model so colors read as pigment soaked into paper
  //   - edges are enhanced and slightly roughened (handcraft line feel)
  //   - a soft bleed halo widens dark edges outward (墨晕)
  //   - optional chromatic bleed pulls the ink color outward at wet edges
  //   - gentle vignette + paper tint
  // uSourceMode: 0 = treat source.alpha as ink density (color from uInkTint,
  // monochrome ink), 1 = keep source.rgb color but soak it into paper (color
  // wash). uBleed widens the halo; uEdge sharpens; uGrain roughens.
  const INKIFY_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uSource;
uniform vec2 uTexel, uRes;
uniform float uBleed, uEdge, uGrain, uSourceMode, uInkStrength, uTime, uSeed, uVignette;
uniform vec3 uInkTint;
uniform vec3 uPaperTint;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21) + uSeed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.07; a *= 0.5; } return v; }
void main(){
  vec2 px = vUv * uRes;
  // paper: warm rice-paper base with fiber + tooth + fine grain
  float fiber = fbm(px * 0.055);
  float tooth = vnoise(px * 0.42);
  float grain = fbm(px * 0.12 + 31.7 + uSeed);
  vec3 paper = uPaperTint;
  paper -= (fiber - 0.5) * 0.05;
  paper -= (tooth - 0.5) * 0.022;

  // Source image sampling. The 2D source canvas is uploaded as a texture via
  // texImage2D with a canvas source (not pixel data), and on this path
  // UNPACK_FLIP_Y is silently ignored by the browser, so texture row 0 stays
  // = image TOP. The display quad has vUv.y=0 at the SCREEN BOTTOM (see VERT),
  // so sampling texture(uSource, vUv) would put image-top at screen-bottom =
  // upside down. Flip the Y of the SOURCE sampling coords only; vUv is left
  // untouched because the paper-grain noise + dye-grid fields are already in
  // the display quad's orientation. This single flip makes the source image
  // render upright in inkify mode, matching the live mode (which bakes into
  // dye-grid fields that were already Y-aligned in bakeSource).
  vec2 sUv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 src = texture(uSource, sUv);
  // ink density: how much this pixel is "drawn". Use luminance of source color
  // weighted by alpha so both dark strokes and colored fills read as ink.
  float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  float density = clamp(src.a * (0.35 + 0.85 * (1.0 - lum)), 0.0, 1.5);

  // sample neighbors for edge + bleed halo (also in flipped source space)
  vec4 l = texture(uSource, sUv - vec2(uTexel.x, 0.0));
  vec4 r = texture(uSource, sUv + vec2(uTexel.x, 0.0));
  vec4 d = texture(uSource, sUv - vec2(0.0, uTexel.y));
  vec4 u = texture(uSource, sUv + vec2(0.0, uTexel.y));
  float ed = length(vec2(r.a - l.a, u.a - d.a));

  // outward bleed halo: dilate the ink mask a little so dark edges feather
  // into the paper like wet ink wicking outward (墨晕).
  float dilate = (l.a + r.a + d.a + u.a) * 0.25;
  float halo = clamp(max(density, dilate) - density, 0.0, 1.0) * uBleed;

  float absorbed = (density + halo * 0.4) * uInkStrength;
  absorbed *= 1.0 + (grain - 0.5) * uGrain * clamp(density * 2.0, 0.0, 1.0);
  absorbed *= 1.0 + ed * uEdge;

  vec3 col;
  if (uSourceMode < 0.5) {
    // monochrome ink: paper darkened by absorption toward the ink tint
    col = paper * exp(-absorbed * uInkTint);
  } else {
    // color wash: keep the source color but soak it — multiply onto paper by
    // absorption so it reads as pigment in paper, not flat vector fill.
    vec3 wash = mix(paper, src.rgb, clamp(density * 1.3, 0.0, 1.0));
    col = mix(paper, wash, clamp(absorbed * 1.4, 0.0, 1.0));
    // darken edges slightly so strokes read as ink lines
    col *= 1.0 - ed * uEdge * 0.18;
  }

  // gentle vignette
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * uVignette;
  o = vec4(col, 1.0);
}`;

  // composite display (inkify-live): the source image's COLOR is held in
  // uSource, but WHERE/WHETHER the color shows is governed by the fluid ink
  // fields (ink + fixed). Water in the sim wets and shifts the ink, so brushing
  // water over the baked image visibly bleeds/moves it. This is the "engine
  // owns the art" mode: result = paper, darkened/colored by (sourceColor masked
  // by fluid ink density), with paper grain + wet darkening + edge bleed.
  const COMPOSITE_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uSource, uInk, uFixed, uWet;
uniform vec2 uTexel, uRes;
uniform float uInkStrength, uEdge, uGrain, uBleed, uTime, uSeed, uVignette;
uniform vec3 uPaperTint;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21) + uSeed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.07; a *= 0.5; } return v; }
void main(){
  vec2 px = vUv * uRes;
  float fiber = fbm(px * 0.055);
  float tooth = vnoise(px * 0.42);
  float grain = fbm(px * 0.12 + 31.7 + uSeed);
  vec3 paper = uPaperTint;
  paper -= (fiber - 0.5) * 0.055;
  paper -= (tooth - 0.5) * 0.024;

  // fluid ink density (what the simulation owns): mobile + fixed pigment
  float dens = texture(uInk, vUv).x + texture(uFixed, vUv).x;
  dens = clamp(dens, 0.0, 1.5);

  // source color, but only where there is ink (mask color by fluid density so
  // water that washed the ink away also removes the color). NOTE: source image
  // is uploaded from a 2D canvas (texImage2D with canvas source) and
  // UNPACK_FLIP_Y is ignored on that path, so texture row 0 = image top while
  // vUv.y=0 is at the screen bottom. The fluid fields below (uInk/uFixed/uWet)
  // are in dye-grid orientation and stay on vUv; ONLY the source color is read
  // with a Y-flipped coord so the dog/pig color lands on the right pixels.
  vec2 sUv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 src = texture(uSource, sUv);
  float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  // art present: any non-white, opaque source pixel is "drawn". Drives whether
  // the SOURCE COLOR shows (keeps the pink dog pink instead of washing to grey).
  float art = src.a * smoothstep(0.92, 0.7, lum);   // ~1 on colored/dark, 0 on white

  // SOURCE COLOR BINDS TO FIXED (方案A 步骤2): the source color only shows
  // where the baked art's fixed ink is still present. When water lifts fixed
  // away, the source color fades with it -> paper shows through -> the user
  // can repaint over it. Without this binding, water would dissolve the ink
  // density but leave the source color hanging (the cat's yellow suitcase
  // stayed visible even after washing — exactly what we don't want).
  // fixedMask: 1 where fixed ink is solid, ramps to 0 as fixed dissolves.
  float fixedDens = texture(uFixed, vUv).x;
  float fixedMask = smoothstep(0.05, 0.25, fixedDens);

  // edge enhancement from the density field (handcraft line feel)
  float l = texture(uInk, vUv - vec2(uTexel.x, 0.0)).x + texture(uFixed, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uInk, vUv + vec2(uTexel.x, 0.0)).x + texture(uFixed, vUv + vec2(uTexel.x, 0.0)).x;
  float d = texture(uInk, vUv - vec2(0.0, uTexel.y)).x + texture(uFixed, vUv - vec2(0.0, uTexel.y)).x;
  float u = texture(uInk, vUv + vec2(0.0, uTexel.y)).x + texture(uFixed, vUv + vec2(0.0, uTexel.y)).x;
  float edge = length(vec2(r - l, u - d));

  float absorbed = dens * uInkStrength;
  absorbed *= 1.0 + (grain - 0.5) * uGrain * clamp(dens * 2.0, 0.0, 1.0);
  absorbed *= 1.0 + edge * uEdge;

  vec3 inkTint = vec3(1.0, 0.965, 0.875);
  vec3 paperInked = paper * exp(-absorbed * inkTint);
  // Where the source image has art AND fixed ink still holds, show its color.
  // fixedMask fades the color out as fixed dissolves (water washes the art).
  float sourceHold = clamp(art * fixedMask, 0.0, 1.0);
  vec3 col = mix(paper, src.rgb, clamp(sourceHold * 1.25, 0.0, 1.0));
  // dark outlines of the source render as ink darkening for a handcraft feel
  col = mix(col, paperInked, clamp((1.0 - lum) * sourceHold * 1.3, 0.0, 1.0));
  // ADD fluid ink on top through the same absorption path. Untouched baked art
  // is protected by sourceHold so it does not cover its own source color, while
  // washed areas and user strokes (mobile or fixed) render as real ink instead
  // of looking like a separate overlay.
  float mobileInk = texture(uInk, vUv).x;
  float freeInk = dens * (1.0 - sourceHold) + mobileInk * (1.0 - fixedMask) * art;
  float extraInk = clamp(freeInk * 1.4, 0.0, 1.0);
  col = mix(col, paperInked, extraInk);

  // wet paper darkens slightly and cools (water visibly wets the art)
  float wraw = texture(uWet, vUv).x;
  float ws = smoothstep(0.02, 0.6, wraw);
  col *= vec3(1.0) - ws * vec3(0.14, 0.13, 0.10);

  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * uVignette;
  o = vec4(col, 1.0);
}`;

  function compileShader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error("shader compile: " + (gl.getShaderInfoLog(s) || "") + "\n" + src);
    }
    return s;
  }

  function linkProgram(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error("program link: " + (gl.getProgramInfoLog(p) || ""));
    }
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const inf = gl.getActiveUniform(p, i);
      uniforms[inf.name] = gl.getUniformLocation(p, inf.name);
    }
    return { program: p, uniforms, bind() { gl.useProgram(p); } };
  }

  function makePipeline(gl) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT);
    const mk = (fs) => linkProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, fs));
    return {
      copy: mk(COPY_FS),
      splat: mk(SPLAT_FS),
      advectVel: mk(ADVECT_VEL_FS),
      curl: mk(CURL_FS),
      vorticity: mk(VORTICITY_FS),
      divergence: mk(DIVERGENCE_FS),
      pressure: mk(PRESSURE_FS),
      gradSub: mk(GRAD_SUB_FS),
      advectWet: mk(ADVECT_WET_FS),
      advectInk: mk(ADVECT_INK_FS),
      exchFixed: mk(EXCHANGE_FIXED_FS),
      exchMobile: mk(EXCHANGE_MOBILE_FS),
      display: mk(DISPLAY_FS),
      inkify: mk(INKIFY_FS),
      composite: mk(COMPOSITE_FS)
    };
  }

  // double-buffered ping-pong field
  function createField(gl, w, h, internalFormat, format, type, filter) {
    function make() {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fbo, w, h };
    }
    let a = make();
    let b = make();
    return {
      w, h, texel: [1 / w, 1 / h],
      get read() { return a; },
      get write() { return b; },
      swap() { const t = a; a = b; b = t; },
      // resize: create new buffers and blit old contents in (resize must preserve content)
      rebuild(nw, nh) {
        w = nw; h = nh;
        this.texel = [1 / w, 1 / h];
        a = make(); b = make();
      },
      // copy an external texture into read (used after rebuild for field preservation)
      copyIn(gl, srcTex) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
        gl.viewport(0, 0, w, h);
        return srcTex;
      }
    };
  }

  // single-buffered scratch FBO (curl, divergence). Has .fbo/.w/.h/.tex so it
  // can be passed directly to _blit(field) and sampled as a texture. These are
  // recomputed every frame, so they do not need ping-pong.
  function createSingle(gl, w, h, internalFormat, format, type, filter) {
    const f = createField(gl, w, h, internalFormat, format, type, filter);
    return { fbo: f.read.fbo, tex: f.read.tex, w, h, texel: f.texel };
  }

  // ---------------------------------------------------------------------------
  // The surface
  // ---------------------------------------------------------------------------

  function hashString(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
  }

  function mulberry32(a) {
    return function () {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  class InkMaterialSurface {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      const gl = canvas.getContext("webgl2", {
        alpha: false, depth: false, stencil: false,
        antialias: false, preserveDrawingBuffer: true,
        premultipliedAlpha: false
      });
      if (!gl) throw new Error("WebGL2 unavailable");
      this.gl = gl;
      gl.getExtension("EXT_color_buffer_float");
      gl.disable(gl.BLEND);

      this.name = options.name || canvas.dataset.materialSurface || "ink";
      this.quality = options.quality in QUALITY ? options.quality : DEFAULT_QUALITY;
      this.state = options.state in STATES ? options.state : DEFAULT_STATE;
      this.preset = options.preset in PRESETS ? options.preset : DEFAULT_PRESET;
      this.params = Object.assign({}, DEFAULT_PARAMS, options.params || {});
      if (options.waterStyle && WATER_STYLES[options.waterStyle]) {
        Object.assign(this.params, WATER_STYLES[options.waterStyle]);
      }
      this.seed = hashString(options.seed || this.name);
      this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.paused = false;
      this.lastTime = performance.now();
      this.lastSizeKey = "";
      this.fixTimer = 0;
      // velocity damping override is boosted while fixing
      this._fixVelDampBoost = 7;
      // current brush footprint (for smudge/bleed boost), z<=0 means inactive
      this._brush = { x: 0.5, y: 0.5, r: 0 };
      // seeded RNG for the dwell swirl stir (reproducible per surface)
      this._swirlRng = mulberry32(Math.floor(this.seed * 0xffffffff) || 1);
      // ambient auto-pulse (water/ink without input). OFF by default to match
      // the reference (water = input only). Product surfaces opt in via options.
      this.ambient = !!options.ambient;
      this._ambientAccum = 0;
      // idle-throttle bookkeeping (see _isLive): last input timestamp + cached
      // wetness check. A still surface sleeps the sim instead of running it.
      this._lastInputAt = 0;
      this._wetCheckAt = 0;
      this._wetAlive = false;

      // inkify mode (path B): when renderMode === "inkify", the surface renders
      // a loaded source image (SVG/raster) through the ink+paper material
      // treatment instead of the fluid sim display. The fluid sim still runs
      // underneath (so you can brush water over the image to re-wet/bleed it).
      // renderMode "live" requires bakeSource() first: the image is baked into
      // the ink/fixed fields, so the fluid sim OWNS the art — brush water over
      // it and the ink (and its color) visibly bleeds and migrates.
      this.renderMode = options.renderMode || "fluid";   // "fluid" | "inkify" | "live"
      this.washableFixedInk = !!options.washableFixedInk;
      this.sourceTexture = null;
      this.sourceMode = options.sourceMode ?? 1;          // 0 mono ink, 1 color wash
      this.inkTint = options.inkTint || [1.0, 0.965, 0.875];
      this.paperTint = options.paperTint || [0.962, 0.954, 0.930];
      this.inkifyStrength = options.inkifyStrength ?? 1.6;
      this.inkifyBleed = options.inkifyBleed ?? 0.5;
      this.inkifyEdge = options.inkifyEdge ?? 1.2;
      this.inkifyGrain = options.inkifyGrain ?? 0.55;
      // vignette 强度（四角暗化）。默认 0.16 = 原视觉，无回归。
      // 设 0 可关掉暗角（用于 keep/restore 循环不累积变暗的场景）。
      this.vignette = options.vignette ?? 0.16;
      // cleanPaper = true means the surface uses product paper as a clean desk
      // substrate: no paper darkening, no wet-paper stain, no vignette.
      this.cleanPaper = !!options.cleanPaper;

      this._buildGeometry();
      this.pipeline = makePipeline(gl);
      // size the canvas + create fields now (before any render/seed) so the dye
      // grid matches the real viewport rather than the default 300x150. _resize
      // creates the fields on first call (haveFields is false).
      this._resize();

      // seed initial marks only when explicitly allowed. Product drawing
      // surfaces disable this so entering draw mode does not create random ink.
      this.setState({ state: this.state, seed: options.seed, clear: false, seedMarks: options.seedMarks !== false });

      // Visibility / offscreen awareness: stop simulating when the tab is hidden
      // or the canvas scrolls out of view. This is the single biggest GPU saving
      // for a workbench with several material surfaces, since each runs its own
      // rAF loop. User pause() takes precedence; on resume we reset lastTime so
      // the first frame after wake does not inject a huge dt spike.
      this._autoPaused = false;
      this._onVisibility = () => { this._updateAutoPause(); };
      document.addEventListener("visibilitychange", this._onVisibility);
      if (typeof IntersectionObserver !== "undefined") {
        this._io = new IntersectionObserver((entries) => {
          for (const e of entries) { this._inView = e.isIntersecting; }
          this._updateAutoPause();
        }, { threshold: 0 });
        this._io.observe(this.canvas);
        this._inView = true;
      }
      this._updateAutoPause();

      this._frame = this._frame.bind(this);
      this._raf = requestAnimationFrame(this._frame);
    }

    _updateAutoPause() {
      const hidden = typeof document !== "undefined" && document.hidden;
      const offscreen = this._io && this._inView === false;
      const shouldPause = hidden || offscreen;
      if (shouldPause && !this._autoPaused) {
        this._autoPaused = true;
      } else if (!shouldPause && this._autoPaused) {
        this._autoPaused = false;
        this.lastTime = performance.now(); // avoid dt spike after wake
      }
    }

    // --- geometry & fields ---------------------------------------------------

    _buildGeometry() {
      const gl = this.gl;
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      this.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }

    _simSize() {
      const q = QUALITY[this.quality];
      const rect = this.canvas.getBoundingClientRect();
      const aspect = (rect.width || 1) / (rect.height || 1);
      // sim grid is small (velocity/pressure); dye grid larger (ink/wet/fixed)
      const sim = aspect >= 1
        ? { w: Math.round(q.simBase * aspect), h: q.simBase }
        : { w: q.simBase, h: Math.round(q.simBase / aspect) };
      const cap = q.dyeBase;
      const dye = aspect >= 1
        ? { w: Math.min(Math.round(cap * aspect), cap * 2), h: Math.min(cap, Math.round(cap * 2 / aspect)) }
        : { w: Math.min(cap, Math.round(cap * 2 * aspect)), h: Math.min(Math.round(cap * 2), Math.round(cap / aspect)) };
      return { sim, dye };
    }

    _initFields(force) {
      const gl = this.gl;
      const q = QUALITY[this.quality];
      const { sim, dye } = this._simSize();
      this.simW = sim.w; this.simH = sim.h;
      this.dyeW = dye.w; this.dyeH = dye.h;
      const F = gl.RG16F, FR = gl.R16F, RG = gl.RG, RED = gl.RED, HF = gl.HALF_FLOAT;

      if (force || !this.velocity) {
        this.velocity = createField(gl, sim.w, sim.h, F, RG, HF, gl.LINEAR);
        this.pressure = createField(gl, sim.w, sim.h, FR, RED, HF, gl.NEAREST);
        this.divergence = createSingle(gl, sim.w, sim.h, FR, RED, HF, gl.NEAREST);
        this.curl = createSingle(gl, sim.w, sim.h, FR, RED, HF, gl.NEAREST);
        this.wet = createField(gl, dye.w, dye.h, FR, RED, HF, gl.LINEAR);
        this.ink = createField(gl, dye.w, dye.h, FR, RED, HF, gl.LINEAR);
        this.fixed = createField(gl, dye.w, dye.h, FR, RED, HF, gl.LINEAR);
      }
    }

    // On resize we rebuild buffers but preserve dye (ink/fixed/wet) content by
    // copying old textures into new ones. Velocity is cheap to lose. On the very
    // first call the fields do not exist yet, so nothing is preserved.
    _resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.max(2, Math.floor((rect.width || this.canvas.width) * dpr));
      const ch = Math.max(2, Math.floor((rect.height || this.canvas.height) * dpr));
      const key = cw + "x" + ch;
      if (key === this.lastSizeKey) return;
      this.lastSizeKey = key;
      this.canvas.width = cw;
      this.canvas.height = ch;

      const haveFields = !!this.ink;
      // stash old dye textures (only if fields already exist)
      const oldInk = haveFields ? this.ink.read.tex : null;
      const oldFixed = haveFields ? this.fixed.read.tex : null;
      const oldWet = haveFields ? this.wet.read.tex : null;
      const oldDyeW = haveFields ? this.dyeW : 0;
      const oldDyeH = haveFields ? this.dyeH : 0;
      // rebuild at new size
      const { sim, dye } = this._simSize();
      const gl = this.gl;
      const F = gl.RG16F, FR = gl.R16F, RG = gl.RG, RED = gl.RED, HF = gl.HALF_FLOAT;
      this.simW = sim.w; this.simH = sim.h;
      this.dyeW = dye.w; this.dyeH = dye.h;
      this.velocity = createField(gl, sim.w, sim.h, F, RG, HF, gl.LINEAR);
      this.pressure = createField(gl, sim.w, sim.h, FR, RED, HF, gl.NEAREST);
      this.divergence = createSingle(gl, sim.w, sim.h, FR, RED, HF, gl.NEAREST);
      this.curl = createSingle(gl, sim.w, sim.h, FR, RED, HF, gl.NEAREST);
      this.wet = createField(gl, dye.w, dye.h, FR, RED, HF, gl.LINEAR);
      this.ink = createField(gl, dye.w, dye.h, FR, RED, HF, gl.LINEAR);
      this.fixed = createField(gl, dye.w, dye.h, FR, RED, HF, gl.LINEAR);
      // blit preserved dye fields (best-effort; sizes differ so it just samples)
      this._blitPreserved(oldInk, this.ink, oldDyeW, oldDyeH);
      this._blitPreserved(oldFixed, this.fixed, oldDyeW, oldDyeH);
      this._blitPreserved(oldWet, this.wet, oldDyeW, oldDyeH);
    }

    _blitPreserved(srcTex, dstField, srcW, srcH) {
      if (!srcTex) return;
      const gl = this.gl;
      const p = this.pipeline.copy;
      p.bind();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(p.uniforms.uTex, 0);
      gl.uniform1f(p.uniforms.uValue, 1.0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dstField.write.fbo);
      gl.viewport(0, 0, dstField.w, dstField.h);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      dstField.swap();
    }

    // --- input splats --------------------------------------------------------

    // mode: 0 = additive (ink/velocity), 1 = max (water keeps the stronger value).
    // Renders directly into field.read (in place, like the inkwash reference
    // splat) and does NOT swap — splats accumulate into the live buffer.
    _splatAdditive(field, x, y, r, color, mode, scissor) {
      const gl = this.gl;
      const f = field.read;
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
      gl.viewport(0, 0, f.w, f.h);
      if (scissor) {
        const ex = Math.ceil(r * 4.5 * f.h) + 2;
        const cx = Math.round(x * f.w), cy = Math.round(y * f.h);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(Math.max(cx - ex, 0), Math.max(cy - ex, 0), ex * 2, ex * 2);
      }
      gl.enable(gl.BLEND);
      if (mode === 1) { gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE); }
      else { gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE); }
      const p = this.pipeline.splat;
      p.bind();
      gl.uniform1f(p.uniforms.uAspect, f.w / f.h);
      gl.uniform2f(p.uniforms.uPoint, x, y);
      gl.uniform4f(p.uniforms.uColor, color[0], color[1], color[2], color[3]);
      gl.uniform1f(p.uniforms.uRadius, r);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
      if (scissor) gl.disable(gl.SCISSOR_TEST);
    }

    // global size multiplier (0.33x .. 3x), matches inkwash sizeMult
    _sizeMult() { return Math.pow(3, (this.params.size - 0.5) * 2); }

    // pen writes mobile ink (+ small wetness per params.penWet). No velocity.
    // radius follows inkwash penRadius scaled by size param; ink darkness scales
    // with the ink param + state.ink.
    pen(opts = {}) {
      this._lastInputAt = performance.now();
      const x = clamp(opts.x ?? 0.5, 0, 1);
      const y = clamp(opts.y ?? 0.5, 0, 1);
      const pressure = clamp(opts.pressure ?? 0.5, 0, 1);
      const speed = clamp(opts.speed ?? 0, 0, 4);
      const cfg = STATES[this.state];
      const sm = this._sizeMult();
      // pen radius follows the inkwash ratio (0.0016 + 0.0042*pr) * sizeMult.
      // Stroke continuity comes from distance-based interpolation in the input
      // layer (pointermove / stroke), not from an oversized radius.
      const base = (0.0016 + 0.0042 * pressure) * clamp(1.12 - speed * 0.3, 0.55, 1.12) * sm;
      const radius = base;
      const dens = (0.55 + 1.05 * pressure) * clamp(1.25 - speed * 0.45, 0.6, 1.25);
      const inkAmount = dens * (0.5 + 1.0 * this.params.ink) * (0.5 + cfg.ink);
      this._splatAdditive(this.ink, x, y, radius, [inkAmount, 0, 0, 0], 0, true);
      const penWet = this.params.penWet;
      if (penWet > 0) {
        this._splatAdditive(this.wet, x, y, radius * 2.8, [penWet, 0, 0, 0], 1, true);
      }
    }

    // brush writes water + velocity (+ optional ink per params.brushInk). The
    // water amount scales with params.flow so the "how much water" feel is
    // adjustable, just like the reference brush. radius scales with size param.
    brush(opts = {}) {
      this._lastInputAt = performance.now();
      const x = clamp(opts.x ?? 0.5, 0, 1);
      const y = clamp(opts.y ?? 0.5, 0, 1);
      const pressure = clamp(opts.pressure ?? 0.5, 0, 1);
      const speed = clamp(opts.speed ?? 0.2, 0, 4);
      const cfg = STATES[this.state];
      const sm = this._sizeMult();
      const radius = (0.014 + 0.060 * pressure) * (1 + Math.min(speed, 2.5) * 0.28) * sm;
      this._brush.x = x; this._brush.y = y; this._brush.r = radius;
      // Water amount is PURE pressure (0.5 + 0.5*pr), like the inkwash reference.
      const wAmp = 0.5 + 0.5 * pressure;
      this._splatAdditive(this.wet, x, y, radius, [wAmp, 0, 0, 0], 1, true);
      // Velocity is what makes water ROTATE. Two sources of swirl, matching the
      // reference brush:
      //   (a) directional push from pointer motion (vx,vy), capped
      //   (b) when the brush dwells (no/low motion), a random-direction stir so
      //       the velocity field develops shear -> curl -> vorticity confinement
      //      放大成漩涡. Without this dwell stir, a still brush produces a flat
      //       uniform push with zero curl, so the water never spins.
      const force = 15 + this.params.flow * 95;
      let vx = (opts.vx ?? 0) * force;
      let vy = (opts.vy ?? 0) * force;
      const vm = Math.hypot(vx, vy);
      const vmax = 240;
      if (vm > vmax) { vx *= vmax / vm; vy *= vmax / vm; }
      const dwell = (vm < radius * 60);   // low motion => dwell
      if (dwell && this.params.swirl > 0) {
        // Stir in a direction that varies per call so the velocity field
        // develops shear -> curl -> vorticity confinement spins up swirls.
        // Strength scales with the swirl param (0 = no stir, "静水" feel) and
        // pressure. Uses a per-surface seeded RNG so behavior is reproducible.
        const a = this._swirlRng() * Math.PI * 2;
        const jm = (6 + 32 * this.params.flow) * pressure * this.params.swirl;
        vx += Math.cos(a) * jm;
        vy += Math.sin(a) * jm;
      }
      if (vx !== 0 || vy !== 0) {
        this._splatAdditive(this.velocity, x, y, radius * 1.15, [vx, vy, 0, 0], 2, true);
      }
      const bdens = this.params.brushInk * 0.10 * (0.4 + 0.6 * pressure) * cfg.ink;
      if (bdens > 0) {
        this._splatAdditive(this.ink, x, y, radius * 0.8, [bdens, 0, 0, 0], 0, true);
      }
    }

    fix(opts = {}) {
      this._lastInputAt = performance.now();
      const strength = clamp(opts.strength ?? 1.0, 0.1, 2.0);
      this.fixTimer = 1.2 * strength;
    }

    inject(opts = {}) {
      const kind = opts.kind || "water";
      if (kind === "ink") return this.injectInk(opts);
      if (kind === "fix" || kind === "fixed") return this.fix(opts);
      return this.injectWater(opts);
    }

    injectInk(opts = {}) {
      this.pen({ x: opts.x, y: opts.y, pressure: opts.strength ?? opts.amount ?? 0.7, speed: 0 });
    }

    injectWater(opts = {}) {
      const r = opts.radius ?? 0.06;
      this.brush({
        x: opts.x, y: opts.y, pressure: opts.strength ?? opts.amount ?? 0.7,
        speed: 0.2, vx: opts.vx ?? 0, vy: opts.vy ?? 0
      });
    }

    // programmatic stroke: array of {x,y,pressure}; tool pen|brush. Crucially,
    // this INTERPOLATES sub-steps between consecutive points (spacing ~ radius),
    // so a stroke lays down a CONTINUOUS line instead of isolated dots. Without
    // this, fast strokes / sparse point lists produce unconnected ink dots.
    stroke(points, opts = {}) {
      const tool = opts.tool || "pen";
      if (!Array.isArray(points) || points.length === 0) return;
      const fn = tool === "brush" ? this.brush : this.pen;
      // current tool radius, used for step spacing
      const sm = this._sizeMult();
      const pr = points[0].pressure ?? 0.6;
      const baseRadius = tool === "brush"
        ? (0.014 + 0.060 * pr) * sm
        : (0.0016 + 0.0042 * pr) * sm;
      for (let i = 0; i < points.length; i++) {
        const p0 = points[i - 1] || points[i];
        const p1 = points[i];
        const dx = (p1.x - p0.x), dy = (p1.y - p0.y);
        const dist = Math.hypot(dx, dy);
        const pressure = p1.pressure ?? 0.6;
        const spacing = Math.max(baseRadius * (tool === "brush" ? 0.45 : 0.22), 0.00025);
        const steps = Math.min(Math.max(Math.ceil(dist / spacing), 1), 180);
        const stepSpeed = (dist / Math.max(steps, 1)) * 60;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          fn.call(this, {
            x: p0.x + dx * t, y: p0.y + dy * t,
            pressure, speed: stepSpeed
          });
        }
      }
      this._brush.r = 0;
    }

    // seed procedural marks for a given kind/role so a surface is not empty
    seedMarks(kind = "ink", count = 5) {
      const rng = mulberry32(Math.floor(this.seed * 0xffffffff));
      for (let i = 0; i < count; i++) {
        const mark = {
          x: 0.1 + rng() * 0.8,
          y: 0.12 + rng() * 0.76,
          radius: 0.02 + rng() * 0.05,
          strength: 0.3 + rng() * 0.5
        };
        if (kind === "water") this.injectWater(mark);
        else if (kind === "fix") this.injectInk(mark);
        else this.injectInk(mark);
      }
    }

    clear() {
      const gl = this.gl;
      const fields = [this.velocity, this.pressure, this.ink, this.fixed, this.wet];
      for (const f of fields) {
        for (const side of [f.read, f.write]) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, side.fbo);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
      }
      this.fixTimer = 0;
    }

    // --- state / preset / quality -------------------------------------------

    setState(opts = {}) {
      if (opts.state && STATES[opts.state]) this.state = opts.state;
      if (opts.preset && PRESETS[opts.preset]) this.preset = opts.preset;
      if (opts.seed !== undefined) this.seed = hashString(String(opts.seed));
      const cfg = STATES[this.state];
      if (opts.clear) this.clear();
      if (cfg.fix) this.fix();
      else this.fixTimer = 0;
      // seed ambient marks unless pure dry paper
      if (opts.seedMarks !== false && !cfg.paperOnly) {
        this.seedMarks("ink", cfg.ink > 0.3 ? 7 : 4);
        if (cfg.wet > 0.2) this.seedMarks("water", Math.round(cfg.wet * 6));
      }
    }

    setPreset(preset) { if (PRESETS[preset]) this.preset = preset; }
    setSeed(seed) {
      this.seed = hashString(String(seed));
      // reseed the swirl RNG so a changed seed produces reproducible swirls
      this._swirlRng = mulberry32(Math.floor(this.seed * 0xffffffff) || 1);
    }
    // Update tunable feel params. Accepts a partial object of {size, flow,
    // bleed, dry, ink, penWet, brushInk, swirl, vortex, color}, a named pen
    // preset ("default"|"bold"|"fine"|"watery"|"drypen"), or a named WATER
    // STYLE ("swirl"|"still"|"wash"|"splash"|"dew").
    setParams(params) {
      if (typeof params === "string") {
        const src = PARAM_PRESETS[params] || WATER_STYLES[params];
        if (src) {
          // pen presets reset everything; water styles only patch water fields
          const base = PARAM_PRESETS[params] ? DEFAULT_PARAMS : this.params;
          this.params = Object.assign({}, base, src);
        }
        return;
      }
      if (params && typeof params === "object") {
        this.params = Object.assign({}, this.params, params);
      }
    }
    // Convenience: switch only the water character (swirl/still/wash/splash/dew).
    setWaterStyle(style) { if (WATER_STYLES[style]) this.setParams(WATER_STYLES[style]); }

    // --- inkify mode (path B: render an external image as handcraft ink art) ---

    setRenderMode(mode) {
      if (mode === "fluid" || mode === "inkify" || mode === "live") this.renderMode = mode;
    }

    // Load an arbitrary image element / canvas / ImageBitmap as the inkify source.
    // The source texture is allowed to be sharper than the dye grid: the dye
    // fields stay small for fluid cost, while sourceTexture keeps color/detail
    // for composite display.
    loadImage(image) {
      const gl = this.gl;
      if (!this.sourceTexture) this.sourceTexture = gl.createTexture();
      // draw the image into an offscreen canvas at display-ish resolution,
      // preserving aspect (letterboxed on the rice-paper background).
      const oc = this._sourceCanvas || (this._sourceCanvas = document.createElement("canvas"));
      const maxSource = 2048;
      const cw = this.canvas.width || this.dyeW;
      const ch = this.canvas.height || this.dyeH;
      const scaleToCap = Math.min(1, maxSource / Math.max(cw, ch));
      const W = Math.max(this.dyeW, Math.round(cw * scaleToCap));
      const H = Math.max(this.dyeH, Math.round(ch * scaleToCap));
      oc.width = W; oc.height = H;
      const ctx = oc.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // rice-paper fill behind the (possibly transparent) image
      ctx.fillStyle = "rgb(245,243,237)";
      ctx.fillRect(0, 0, W, H);
      const iw = image.naturalWidth || image.width;
      const ih = image.naturalHeight || image.height;
      const scale = Math.min(W / iw, H / ih);
      const dw = iw * scale, dh = ih * scale;
      ctx.drawImage(image, (W - dw) / 2, (H - dh) / 2, dw, dh);
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      // FLIP_Y on upload: canvas/texture origin is top-left, but the display
      // quad maps vUv.y=0 to the SCREEN bottom (gl_Position y=-1 -> bottom).
      // Without flipping, texture row 0 (image top) lands at the screen bottom,
      // so the art is upside down. Flip Y so image top renders at screen top.
      gl.pixelStorei(gl.UNPACK_FLIP_Y, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, oc);
      gl.pixelStorei(gl.UNPACK_FLIP_Y, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    // Load an SVG string as the inkify source. Rasterizes via an <img> with a
    // data URL. Returns a promise that resolves when the image is loaded.
    loadSVG(svgString) {
      return new Promise((resolve, reject) => {
        const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { this.loadImage(img); URL.revokeObjectURL(url); resolve(); };
        img.onerror = (e) => { URL.revokeObjectURL(url); reject(new Error("SVG load failed")); };
        img.src = url;
      });
    }

    // Bake the loaded source image into the engine's ink/fixed fields so the
    // fluid simulation can act on it. The image's per-pixel ink density
    // (luminance+alpha) becomes BOTH the fixed layer (so it persists) and the
    // wet+velocity fields get a faint seed so water can immediately move it.
    // After baking, switching renderMode to "fluid" lets you brush water over
    // the image and watch the ink bleed/migrate — the engine now OWNS the art.
    bakeSource(opts = {}) {
      if (!this.sourceTexture || !this._sourceCanvas) return;
      const oc = this._sourceCanvas;
      const ctx = oc.getContext("2d");
      const W = oc.width, H = oc.height;
      const imgData = ctx.getImageData(0, 0, W, H);
      const data = imgData.data;
      const gl = this.gl;
      const densityScale = opts.density ?? 0.9;
      const wetSeed = opts.wet ?? 0.0;
      // Build ink + fixed field textures from the image density. We write them
      // as R8-ish byte textures via a temp canvas → texImage2D into the .read
      // side, then copy to .write. Density in RED channel, scaled.
      const inkCanvas = document.createElement("canvas");
      inkCanvas.width = this.dyeW; inkCanvas.height = this.dyeH;
      const ictx = inkCanvas.getContext("2d");
      const iData = ictx.createImageData(this.dyeW, this.dyeH);
      // map image (W×H) onto dye grid (dyeW×dyeH) by nearest-sample
      for (let y = 0; y < this.dyeH; y++) {
        const sy = Math.floor(y / this.dyeH * H);
        for (let x = 0; x < this.dyeW; x++) {
          const sx = Math.floor(x / this.dyeW * W);
          const si = (sy * W + sx) * 4;
          const r = data[si], g = data[si + 1], b = data[si + 2], a = data[si + 3];
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          const alpha = a / 255;
          // density: how "drawn" this pixel is. Low-chroma near-paper pixels
          // are usually conversion/antialias edges, not pigment; a hard
          // lum>0.92 cutoff creates a sharp density cliff there, which water
          // exposes as a white outline. Gate density with a soft mark score so
          // neutral paper-like edges feather away while saturated pale colors
          // and real dark strokes still bake into the material.
          const maxc = Math.max(r, g, b) / 255;
          const minc = Math.min(r, g, b) / 255;
          const darkness = Math.max(0, 1.0 - lum);
          const chroma = Math.max(0, maxc - minc);
          const mark = darkness + chroma * 0.75;
          let dens = alpha * darkness * smoothstep(0.12, 0.2, mark);
          dens = Math.min(1, dens * densityScale);
          // FLIP Y HERE in JS: write row y of the dye grid from the OPPOSITE end
          // so that when uploaded WITHOUT UNPACK_FLIP_Y, texture row 0 = image
          // bottom. The fluid fields must stay unflipped at the GL level (the sim
          // ping-pongs them without FLIP_Y), but the display samples vUv y-up —
          // so we flip in the data itself to keep the baked ink upright and
          // matching the (FLIP_Y'd) source texture.
          const di = ((this.dyeH - 1 - y) * this.dyeW + x) * 4;
          iData.data[di] = Math.round(dens * 255);
          iData.data[di + 3] = 255;
        }
      }
      ictx.putImageData(iData, 0, 0);
      // The ink/fixed fields are half-float (R16F/HALF_FLOAT). We cannot upload
      // UNSIGNED_BYTE pixels directly into them (format mismatch -> GL error).
      // Instead create a temporary byte texture, then use a copy-style blit to
      // sample it into the half-float field. Use the advectInk pipeline is over-
      // kill; simplest: a dedicated upload via a temp texture + the copy shader.
      const tmpTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tmpTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // NO UNPACK_FLIP_Y on the fluid-field upload: the sim ping-pongs these
      // fields without flip, so a flip here would be undone on the first step
      // and leave the field upside-down relative to the source. The Y flip is
      // done in the data itself above (row reversal) instead.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, inkCanvas);
      const bakeInto = (field) => {
        const cp = this.pipeline.copy;
        cp.bind();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tmpTex); gl.uniform1i(cp.uniforms.uTex, 0);
        gl.uniform1f(cp.uniforms.uValue, 1.0);
        this._blit(field.write); field.swap();
      };
      bakeInto(this.ink);
      bakeInto(this.fixed);
      gl.deleteTexture(tmpTex);
      // copy read->write so both sides match
      const sync = (field) => {
        const p = this.pipeline.copy;
        p.bind();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, field.read.tex); gl.uniform1i(p.uniforms.uTex, 0);
        gl.uniform1f(p.uniforms.uValue, 1.0);
        this._blit(field.write); field.swap();
        // now write has the data; swap again so read keeps it too
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, field.read.tex); gl.uniform1i(p.uniforms.uTex, 0);
        this._blit(field.write); field.swap();
      };
      sync(this.ink); sync(this.fixed);
      // optional faint wet seed so water reacts immediately
      if (wetSeed > 0) {
        for (let i = 0; i < 8; i++) {
          this.injectWater({ x: 0.2 + Math.random() * 0.6, y: 0.2 + Math.random() * 0.6, radius: 0.06, strength: wetSeed });
        }
      }
    }

    setQuality(q) {
      if (!QUALITY[q]) return;
      this.quality = q;
      this._resizeForce();
    }
    _resizeForce() {
      this.lastSizeKey = "";
      const oldInk = this.ink.read.tex, oldFixed = this.fixed.read.tex, oldWet = this.wet.read.tex;
      const oldDyeW = this.dyeW, oldDyeH = this.dyeH;
      const { sim, dye } = this._simSize();
      const gl = this.gl;
      const F = gl.RG16F, FR = gl.R16F, RG = gl.RG, RED = gl.RED, HF = gl.HALF_FLOAT;
      this.simW = sim.w; this.simH = sim.h;
      this.dyeW = dye.w; this.dyeH = dye.h;
      this.velocity = createField(gl, sim.w, sim.h, F, RG, HF, gl.LINEAR);
      this.pressure = createField(gl, sim.w, sim.h, FR, RED, HF, gl.NEAREST);
      this.divergence = createSingle(gl, sim.w, sim.h, FR, RED, HF, gl.NEAREST);
      this.curl = createSingle(gl, sim.w, sim.h, FR, RED, HF, gl.NEAREST);
      this.wet = createField(gl, dye.w, dye.h, FR, RED, HF, gl.LINEAR);
      this.ink = createField(gl, dye.w, dye.h, FR, RED, HF, gl.LINEAR);
      this.fixed = createField(gl, dye.w, dye.h, FR, RED, HF, gl.LINEAR);
      this._blitPreserved(oldInk, this.ink, oldDyeW, oldDyeH);
      this._blitPreserved(oldFixed, this.fixed, oldDyeW, oldDyeH);
      this._blitPreserved(oldWet, this.wet, oldDyeW, oldDyeH);
    }

    pause() { this.paused = true; }
    resume() { if (this.paused) { this.paused = false; this.lastTime = performance.now(); } }

    getState() {
      const cfg = STATES[this.state];
      return {
        name: this.name,
        state: this.state,
        stateLabel: cfg.label,
        preset: this.preset,
        quality: this.quality,
        seed: this.seed,
        fixing: this.fixTimer > 0,
        reduced: this.reduced,
        paused: this.paused,
        params: { ...this.params },
        resolution: { sim: [this.simW, this.simH], dye: [this.dyeW, this.dyeH] },
        config: { ...cfg }
      };
    }

    // --- simulation step -----------------------------------------------------

    _step(dt) {
      const gl = this.gl;
      const q = QUALITY[this.quality];
      const cfg = STATES[this.state];
      const preset = PRESETS[this.preset];
      const fixing = this.fixTimer > 0;
      if (fixing) this.fixTimer -= dt;
      // Merge tunable params with the state config. The param value dominates
      // the feel (size/flow/bleed/dry are user-controlled); the state only adds
      // a baseline so e.g. "running" is wetter than "idle" even at equal params.
      const pm = this.params;
      const flow = clamp(0.5 * cfg.flow + 0.5 * pm.flow, 0, 1);
      const dry = clamp(0.5 * cfg.dry + 0.5 * pm.dry, 0, 1);
      const bleed = clamp(0.5 * preset.bleed + 0.5 * pm.bleed, 0, 1);

      const simTexel = this.velocity.texel;
      const dyeTexel = this.ink.texel;

      // 2. velocity advect + damp, masked by wet. Extra damping while fixing.
      {
        const p = this.pipeline.advectVel;
        p.bind();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex); gl.uniform1i(p.uniforms.uVelocity, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.wet.read.tex); gl.uniform1i(p.uniforms.uWet, 1);
        gl.uniform2f(p.uniforms.uTexel, simTexel[0], simTexel[1]);
        gl.uniform1f(p.uniforms.uDt, dt);
        // velocity dissipation matches inkwash exactly: exp(-dt*(3.0 - flow*2.4)),
        // with extra exp(-dt*7) while fixing. (flow*2.4, not 1.2.)
        const damp = Math.exp(-dt * (3.0 - flow * 2.4)) * (fixing ? Math.exp(-dt * 7) : 1);
        gl.uniform1f(p.uniforms.uDissipation, damp);
        this._blit(this.velocity.write); this.velocity.swap();
      }

      // 3. curl
      {
        const p = this.pipeline.curl;
        p.bind();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex); gl.uniform1i(p.uniforms.uVelocity, 0);
        gl.uniform2f(p.uniforms.uTexel, simTexel[0], simTexel[1]);
        this._blit(this.curl);
      }

      // 3b. vorticity confinement
      {
        const p = this.pipeline.vorticity;
        p.bind();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex); gl.uniform1i(p.uniforms.uVelocity, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.curl.tex); gl.uniform1i(p.uniforms.uCurl, 1);
        gl.uniform2f(p.uniforms.uTexel, simTexel[0], simTexel[1]);
        // vorticity strength: inkwash base (4 + flow*22) scaled by the vortex
        // param so water styles can dial rotation up (splash/swirl) or down
        // (still/dew/wash).
        gl.uniform1f(p.uniforms.uCurlAmt, (4 + flow * 22) * (pm.vortex ?? 1));
        gl.uniform1f(p.uniforms.uDt, dt);
        this._blit(this.velocity.write); this.velocity.swap();
      }

      // 4. divergence
      {
        const p = this.pipeline.divergence;
        p.bind();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex); gl.uniform1i(p.uniforms.uVelocity, 0);
        gl.uniform2f(p.uniforms.uTexel, simTexel[0], simTexel[1]);
        this._blit(this.divergence);
      }

      // 4b. pressure Jacobi (dissipate previous pressure a touch first)
      {
        const pc = this.pipeline.copy;
        pc.bind();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.pressure.read.tex); gl.uniform1i(pc.uniforms.uTex, 0);
        gl.uniform1f(pc.uniforms.uValue, 0.8);
        this._blit(this.pressure.write); this.pressure.swap();

        const p = this.pipeline.pressure;
        p.bind();
        gl.uniform2f(p.uniforms.uTexel, simTexel[0], simTexel[1]);
        // divergence is read-only across all iterations: bind once.
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.divergence.tex); gl.uniform1i(p.uniforms.uDivergence, 1);
        for (let i = 0; i < q.pressureIter; i++) {
          // pressure.read changes each iter (we swap), so rebind unit 0 only.
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.pressure.read.tex);
          this._blit(this.pressure.write); this.pressure.swap();
        }
      }

      // 4c. gradient subtraction
      {
        const p = this.pipeline.gradSub;
        p.bind();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.pressure.read.tex); gl.uniform1i(p.uniforms.uPressure, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex); gl.uniform1i(p.uniforms.uVelocity, 1);
        gl.uniform2f(p.uniforms.uTexel, simTexel[0], simTexel[1]);
        this._blit(this.velocity.write); this.velocity.swap();
      }

      // 5. wetness advect + creep + decay
      {
        const p = this.pipeline.advectWet;
        p.bind();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.wet.read.tex); gl.uniform1i(p.uniforms.uWet, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex); gl.uniform1i(p.uniforms.uVelocity, 1);
        gl.uniform2f(p.uniforms.uTexel, simTexel[0], simTexel[1]);
        gl.uniform2f(p.uniforms.uSrcTexel, dyeTexel[0], dyeTexel[1]);
        gl.uniform1f(p.uniforms.uDt, dt);
        const dryTau = fixing ? 0.25 : 2 + (1 - dry) * 16;
        gl.uniform1f(p.uniforms.uDecay, Math.exp(-dt / dryTau));
        gl.uniform1f(p.uniforms.uSpread, 0.12);
        this._blit(this.wet.write); this.wet.swap();
      }

      // 6. mobile ink advect + bleed (wet-gated)
      {
        const p = this.pipeline.advectInk;
        p.bind();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex); gl.uniform1i(p.uniforms.uVelocity, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.ink.read.tex); gl.uniform1i(p.uniforms.uInk, 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.wet.read.tex); gl.uniform1i(p.uniforms.uWet, 2);
        gl.uniform2f(p.uniforms.uTexel, simTexel[0], simTexel[1]);
        gl.uniform2f(p.uniforms.uSrcTexel, dyeTexel[0], dyeTexel[1]);
        gl.uniform1f(p.uniforms.uDt, dt);
        gl.uniform1f(p.uniforms.uBleed, bleed);
        gl.uniform2f(p.uniforms.uMobLowHigh, preset.inkMobilityLow, preset.inkMobilityHigh);
        gl.uniform1f(p.uniforms.uAspect, this.dyeW / this.dyeH);
        gl.uniform3f(p.uniforms.uBrush, this._brush.x, this._brush.y, this._brush.r);
        this._blit(this.ink.write); this.ink.swap();
      }
      // brush footprint only valid for the frame it was set
      this._brush.r = 0;

      // 7. exchange: settle mobile into fixed on fix; opt-in re-wet lift.
      // lift is gated to renderMode==="live" AND requires recent brush input
      // (方案A fix): a constant lift drains baked fixed into mobile within a
      // few sim frames even with no user input, because ambient wet / sim
      // diffusion spreads wetness everywhere. Result: the whole image "melts"
      // into mobile ink on its own, then water scatters it -> the washed area
      // shows a residual outline and pen strokes look like a separate layer.
      // Fix: lift only fires while the user is actively brushing (within 400ms
      // of the last input), so the baked art stays put until deliberately washed.
      {
        const settle = fixing ? 1 - Math.exp(-dt * 5) : 0;
        const recentBrush = this._lastInputAt && (performance.now() - this._lastInputAt) < 400;
        const canLiftFixed = this.renderMode === "live" || this.washableFixedInk;
        const lift = (canLiftFixed && recentBrush) ? 1.5 : preset.fixedLift;
        const ef = this.pipeline.exchFixed;
        ef.bind();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fixed.read.tex); gl.uniform1i(ef.uniforms.uFixed, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.ink.read.tex); gl.uniform1i(ef.uniforms.uInk, 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.wet.read.tex); gl.uniform1i(ef.uniforms.uWet, 2);
        gl.uniform1f(ef.uniforms.uSettle, settle);
        gl.uniform1f(ef.uniforms.uLift, lift);
        gl.uniform1f(ef.uniforms.uDt, dt);
        this._blit(this.fixed.write);

        const em = this.pipeline.exchMobile;
        em.bind();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fixed.read.tex); gl.uniform1i(em.uniforms.uFixed, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.ink.read.tex); gl.uniform1i(em.uniforms.uInk, 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.wet.read.tex); gl.uniform1i(em.uniforms.uWet, 2);
        gl.uniform1f(em.uniforms.uSettle, settle);
        gl.uniform1f(em.uniforms.uLift, lift);
        gl.uniform1f(em.uniforms.uDt, dt);
        this._blit(this.ink.write);

        this.fixed.swap(); this.ink.swap();
      }

      // ambient breathing: OFF by default. The reference engine's water comes
      // ONLY from brush input — there is no auto-pulse. For product surfaces
      // that have no pointer input (runtime/evidence/review/memory), set
      // surface.ambient = true to let the state gently breathe; otherwise the
      // engine stays faithful to the reference (water = input only).
      if (this.ambient && !this.reduced && !fixing) {
        this._ambientAccum += dt;
        const period = flow > 0.3 ? 0.7 : (flow > 0.1 ? 1.6 : 99);
        if (this._ambientAccum > period && flow > 0.08) {
          this._ambientAccum = 0;
          const rng = mulberry32(Math.floor((performance.now() * 0.001) ^ (this.seed * 1e6)));
          const x = 0.2 + rng() * 0.6;
          const y = 0.25 + rng() * 0.5;
          this.brush({ x, y, pressure: 0.4 + rng() * 0.3, speed: 0.3, vx: (rng() - 0.5) * 0.4, vy: (rng() - 0.5) * 0.2 });
          if (rng() < cfg.ink) this.pen({ x: x + (rng() - 0.5) * 0.1, y: y + (rng() - 0.5) * 0.1, pressure: 0.5, speed: 0.1 });
        }
      }
    }

    _render(now) {
      const gl = this.gl;
      if (this.renderMode === "live" && this.sourceTexture) { this._renderComposite(now); return; }
      if (this.renderMode === "inkify" && this.sourceTexture) { this._renderInkify(now); return; }
      const cfg = STATES[this.state];
      const p = this.pipeline.display;
      p.bind();
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.ink.read.tex); gl.uniform1i(p.uniforms.uInk, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.wet.read.tex); gl.uniform1i(p.uniforms.uWet, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.fixed.read.tex); gl.uniform1i(p.uniforms.uFixed, 2);
      gl.uniform2f(p.uniforms.uTexel, this.ink.texel[0], this.ink.texel[1]);
      gl.uniform2f(p.uniforms.uRes, this.canvas.width, this.canvas.height);
      gl.uniform1f(p.uniforms.uInkStrength, 1.9);
      gl.uniform1f(p.uniforms.uEdge, 1.35);
      gl.uniform1f(p.uniforms.uGrain, 0.55);
      gl.uniform1f(p.uniforms.uPaperFade, cfg.paperOnly ? 0.55 : 0.0);
      gl.uniform1f(p.uniforms.uTime, now * 0.001);
      gl.uniform1f(p.uniforms.uSeed, this.seed);
      gl.uniform1f(p.uniforms.uVignette, this.vignette);
      gl.uniform3f(p.uniforms.uPaperTint, this.paperTint[0], this.paperTint[1], this.paperTint[2]);
      gl.uniform1i(p.uniforms.uCleanPaper, this.cleanPaper ? 1 : 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    _renderInkify(now) {
      const gl = this.gl;
      const p = this.pipeline.inkify;
      p.bind();
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture); gl.uniform1i(p.uniforms.uSource, 0);
      // texel of the source = dye grid spacing
      gl.uniform2f(p.uniforms.uTexel, this.ink.texel[0], this.ink.texel[1]);
      gl.uniform2f(p.uniforms.uRes, this.canvas.width, this.canvas.height);
      gl.uniform1f(p.uniforms.uBleed, this.inkifyBleed);
      gl.uniform1f(p.uniforms.uEdge, this.inkifyEdge);
      gl.uniform1f(p.uniforms.uGrain, this.inkifyGrain);
      gl.uniform1f(p.uniforms.uSourceMode, this.sourceMode);
      gl.uniform1f(p.uniforms.uInkStrength, this.inkifyStrength);
      gl.uniform1f(p.uniforms.uTime, now * 0.001);
      gl.uniform1f(p.uniforms.uSeed, this.seed);
      gl.uniform1f(p.uniforms.uVignette, this.vignette);
      gl.uniform3f(p.uniforms.uInkTint, this.inkTint[0], this.inkTint[1], this.inkTint[2]);
      gl.uniform3f(p.uniforms.uPaperTint, this.paperTint[0], this.paperTint[1], this.paperTint[2]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    _renderComposite(now) {
      const gl = this.gl;
      const p = this.pipeline.composite;
      p.bind();
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture); gl.uniform1i(p.uniforms.uSource, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.ink.read.tex); gl.uniform1i(p.uniforms.uInk, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.fixed.read.tex); gl.uniform1i(p.uniforms.uFixed, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.wet.read.tex); gl.uniform1i(p.uniforms.uWet, 3);
      gl.uniform2f(p.uniforms.uTexel, this.ink.texel[0], this.ink.texel[1]);
      gl.uniform2f(p.uniforms.uRes, this.canvas.width, this.canvas.height);
      gl.uniform1f(p.uniforms.uInkStrength, this.inkifyStrength);
      gl.uniform1f(p.uniforms.uEdge, this.inkifyEdge);
      gl.uniform1f(p.uniforms.uGrain, this.inkifyGrain);
      gl.uniform1f(p.uniforms.uBleed, this.inkifyBleed);
      gl.uniform1f(p.uniforms.uTime, now * 0.001);
      gl.uniform1f(p.uniforms.uSeed, this.seed);
      gl.uniform1f(p.uniforms.uVignette, this.vignette);
      gl.uniform3f(p.uniforms.uPaperTint, this.paperTint[0], this.paperTint[1], this.paperTint[2]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    _blit(field) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, field.fbo);
      gl.viewport(0, 0, field.w, field.h);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    _frame(now) {
      // Both user pause() and auto-pause (hidden tab / offscreen canvas) skip
      // the sim+render but keep the rAF alive so we wake cheaply.
      if (this.paused || this._autoPaused) {
        this.lastTime = now;
        this._raf = requestAnimationFrame(this._frame);
        return;
      }
      this._resize();
      let dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
      dt = Math.min(dt, 1 / 30);
      // Idle throttling: the fluid sim is expensive (22 Jacobi iters + curl +
      // vorticity per frame). Only run it when there is actual motion — recent
      // input, active wetness, or a fixing pass — or the surface opts in to
      // ambient. inkify (static post-process) NEVER needs the sim. This is the
      // single biggest CPU/GPU saving: a still surface coasts at near-zero cost
      // instead of running the full Navier-Stokes solve every frame.
      const needsSim = this.renderMode !== "inkify" && this._isLive();
      if (needsSim) this._step(dt);
      this._render(now);
      this._raf = requestAnimationFrame(this._frame);
    }

    // True when the fluid field is actually doing something worth simulating:
    // recent pointer input, non-trivial wetness, ongoing fix, or ambient mode.
    // A dry idle surface returns false so the sim sleeps.
    _isLive() {
      if (this._lastInputAt && (performance.now() - this._lastInputAt) < 600) return true;
      if (this.fixTimer > 0) return true;
      if (this.ambient) return true;
      // sample-based wetness check: if the wet field max is below threshold the
      // water has dried; no need to keep solving. Checked every ~250ms.
      if (performance.now() - (this._wetCheckAt || 0) > 250) {
        this._wetCheckAt = performance.now();
        this._wetAlive = this._measureWetAlive();
      }
      return this._wetAlive;
    }

    // cheap max-over-grid read of the wet field (FLOAT) to decide if water is
    // still present anywhere. Returns true if any cell exceeds the threshold.
    _measureWetAlive() {
      const gl = this.gl;
      const threshold = 0.04;
      try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.wet.read.fbo);
        const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (fbStatus !== gl.FRAMEBUFFER_COMPLETE) return false;
        for (let gy = 0; gy < 6; gy++) {
          for (let gx = 0; gx < 8; gx++) {
            const p = new Float32Array(4);
            gl.readPixels(
              Math.floor((gx + 0.5) / 8 * this.dyeW),
              Math.floor((gy + 0.5) / 6 * this.dyeH),
              1, 1, gl.RGBA, gl.FLOAT, p
            );
            if (p[0] > threshold) return true;
          }
        }
      } catch (e) { /* ignore read errors */ }
      return false;
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      if (this._onVisibility) document.removeEventListener("visibilitychange", this._onVisibility);
      if (this._io) this._io.disconnect();
      // best-effort GL cleanup. Fields are either double-buffered (have
      // .read/.write) or single scratch (have .tex/.fbo only).
      const gl = this.gl;
      try {
        const freeSide = (side) => { if (side) { gl.deleteTexture(side.tex); gl.deleteFramebuffer(side.fbo); } };
        for (const f of [this.velocity, this.pressure, this.wet, this.ink, this.fixed]) {
          if (!f) continue;
          if (f.read) { freeSide(f.read); freeSide(f.write); }
          else { freeSide(f); }
        }
        for (const f of [this.divergence, this.curl]) { if (f) freeSide(f); }
        if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
        gl.deleteBuffer(this.vbo);
        gl.deleteVertexArray(this.vao);
      } catch (e) { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Public export
  // ---------------------------------------------------------------------------

  window.InkMaterial = {
    STATES: Object.keys(STATES),
    STATE_INFO: STATES,
    PRESETS: Object.keys(PRESETS),
    PRESET_INFO: PRESETS,
    QUALITY: Object.keys(QUALITY),
    PARAMS: Object.keys(DEFAULT_PARAMS),
    PARAM_DEFAULTS: DEFAULT_PARAMS,
    PARAM_PRESETS: Object.keys(PARAM_PRESETS),
    WATER_STYLES: Object.keys(WATER_STYLES),
    WATER_STYLE_INFO: WATER_STYLES,
    create(canvas, options) {
      return new InkMaterialSurface(canvas, options);
    },
    // convenience: headless render check for verification scripts
    isWebGL2Available() {
      try {
        const c = document.createElement("canvas");
        return !!c.getContext("webgl2");
      } catch (e) { return false; }
    }
  };
})();
