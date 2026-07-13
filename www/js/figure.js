// SVG characters: a side-profile figure (posture monitor, mobility section,
// chin tucks) and a front-facing figure (flexibility test, lateral moves).
// Both are dumb renderers — callers drive them with set({...}) each frame.

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

const INK = '#2E2A3B';
const SKIN = '#FFD9B8';
const SKIN_EDGE = '#F2B98C';
const SHIRT = '#17B8A6';
const SHIRT_DARK = '#0E8F82';

// Mouth paths per zone (drawn in head-local coordinates).
const MOUTHS = {
  upright:  'M 168 120 Q 176 127 184 119',        // smile
  mild:     'M 168 122 L 183 121',                // flat
  moderate: 'M 168 125 Q 176 119 184 124',        // frown
  severe:   'M 170 121 Q 176 130 183 122 Q 177 126 170 121', // wobbly
};

// ─────────────────────────── side profile ───────────────────────────
export function createSideFigure(container, { showWeight = true, showArc = true } = {}) {
  const svg = el('svg', { viewBox: '0 0 320 310', role: 'img', 'aria-label': 'Side profile of your posture' });

  // floor shadow
  el('ellipse', { cx: 160, cy: 292, rx: 92, ry: 12, fill: 'rgba(46,42,59,.07)' }, svg);

  // torso (leaning slightly forward), drawn as fat rounded strokes
  el('path', {
    d: 'M 142 288 L 150 200 Q 153 168 160 156',
    stroke: SHIRT, 'stroke-width': 52, 'stroke-linecap': 'round', fill: 'none',
  }, svg);
  // hip/leg hint
  el('path', {
    d: 'M 142 286 Q 170 292 196 286',
    stroke: '#3E3860', 'stroke-width': 34, 'stroke-linecap': 'round', fill: 'none',
  }, svg);

  const PIVOT = { x: 163, y: 150 };

  // reference plumb line + angle arc annotation
  let arc = null, plumb = null;
  if (showArc) {
    plumb = el('line', {
      x1: PIVOT.x, y1: PIVOT.y - 96, x2: PIVOT.x, y2: PIVOT.y - 10,
      stroke: '#C9C3B8', 'stroke-width': 2, 'stroke-dasharray': '3 6', 'stroke-linecap': 'round',
    }, svg);
    arc = el('path', { fill: 'none', stroke: '#FF6B5E', 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0 }, svg);
  }

  // ── neck (drawn under the head, bends as a curve rather than a hinge —
  // a rigid rotation reads as a broken hinge; a quadratic arc that lags the
  // head's rotation reads as an actual neck) ──
  const neck = el('path', {
    d: `M ${PIVOT.x} ${PIVOT.y + 4} L 166 118`,
    stroke: SKIN, 'stroke-width': 24, 'stroke-linecap': 'round', fill: 'none',
  }, svg);
  const NECK_END = { x: 166, y: 118 };

  // ── head group (rotates about the neck base) ──
  const head = el('g', {}, svg);
  el('circle', { cx: 172, cy: 96, r: 36, fill: SKIN, stroke: SKIN_EDGE, 'stroke-width': 2.5 }, head);
  el('path', { // hair swoosh
    d: 'M 141 82 Q 150 52 180 60 Q 205 66 206 88 Q 196 76 178 76 Q 152 76 148 96 Q 143 90 141 82',
    fill: INK,
  }, head);
  el('circle', { cx: 158, cy: 96, r: 5, fill: '#F5B98F' }, head); // ear
  const eye = el('circle', { cx: 190, cy: 92, r: 3.6, fill: INK }, head);
  const brow = el('path', { d: 'M 184 82 L 196 82', stroke: INK, 'stroke-width': 2.5, 'stroke-linecap': 'round', fill: 'none' }, head);
  const mouth = el('path', { d: MOUTHS.upright, stroke: INK, 'stroke-width': 2.8, 'stroke-linecap': 'round', fill: 'none' }, head);

  // ── kettlebell strain weight, strapped to the nape of the neck so it
  // rides with the head and can never cover the face ──
  let weight = null, weightLabel = null;
  if (showWeight) {
    weight = el('g', { opacity: 0 }, head);
    el('path', { d: 'M -9 -14 Q 0 -26 9 -14', stroke: '#4A4560', 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round' }, weight);
    el('circle', { cx: 0, cy: 4, r: 17, fill: '#4A4560' }, weight);
    weightLabel = el('text', {
      x: 0, y: 8, 'text-anchor': 'middle', fill: '#fff',
      'font-size': 10.5, 'font-weight': 800, 'font-family': 'inherit',
    }, weight);
  }

  // arm holding phone (rotates a little with the slump)
  const arm = el('g', {}, svg);
  el('path', {
    d: 'M 158 178 Q 190 196 212 184',
    stroke: SHIRT_DARK, 'stroke-width': 20, 'stroke-linecap': 'round', fill: 'none',
  }, arm);
  el('circle', { cx: 214, cy: 183, r: 10, fill: SKIN }, arm);
  const phone = el('g', {}, arm);
  el('rect', { x: 206, y: 158, width: 17, height: 30, rx: 4, fill: INK }, phone);
  el('rect', { x: 208.5, y: 161, width: 12, height: 24, rx: 2, fill: '#8FD8FF' }, phone);

  container.appendChild(svg);

  // rotate a point about the pivot
  const rotPt = (p, deg) => {
    const r = (deg * Math.PI) / 180;
    const dx = p.x - PIVOT.x, dy = p.y - PIVOT.y;
    return {
      x: PIVOT.x + dx * Math.cos(r) - dy * Math.sin(r),
      y: PIVOT.y + dx * Math.sin(r) + dy * Math.cos(r),
    };
  };

  function set({ angle = 0, zone = 'upright', kg = null, armBack = 0 }) {
    const a = Math.max(-20, Math.min(75, angle));
    head.setAttribute('transform', `rotate(${a}, ${PIVOT.x}, ${PIVOT.y})`);

    // the neck arcs into the bend: its end follows the head's rotation while
    // its midpoint lags at roughly half the angle
    const end = rotPt(NECK_END, a);
    const mid0 = { x: (PIVOT.x + NECK_END.x) / 2, y: (PIVOT.y + NECK_END.y) / 2 };
    const ctrl = rotPt(mid0, a * 0.45);
    neck.setAttribute('d', `M ${PIVOT.x} ${PIVOT.y + 4} Q ${ctrl.x} ${ctrl.y} ${end.x} ${end.y}`);

    mouth.setAttribute('d', MOUTHS[zone] || MOUTHS.upright);
    brow.setAttribute('transform', zone === 'severe' || zone === 'moderate' ? 'rotate(12 190 82)' : '');
    eye.setAttribute('r', zone === 'severe' ? 2.6 : 3.6);

    // arm dips gently as the head does; chest-opener swings it behind the back
    const armRot = armBack ? -34 * armBack : a * 0.22;
    arm.setAttribute('transform', `rotate(${armRot}, 158, 172)`);
    phone.setAttribute('transform', `rotate(${a * 0.38}, 214, 173)`);

    if (arc) {
      if (a > 4) {
        const r = 70, rad = ((a - 90) * Math.PI) / 180;
        const ex = PIVOT.x + r * Math.cos(rad);
        const ey = PIVOT.y + r * Math.sin(rad);
        arc.setAttribute('d', `M ${PIVOT.x} ${PIVOT.y - r} A ${r} ${r} 0 0 1 ${ex} ${ey}`);
        arc.setAttribute('opacity', 0.9);
      } else {
        arc.setAttribute('opacity', 0);
      }
    }

    if (weight) {
      if (kg != null && a > 8) {
        const s = 0.75 + (kg / 27) * 0.6;
        weight.setAttribute('transform', `translate(124, 122) scale(${s})`);
        weight.setAttribute('opacity', Math.min(1, (a - 8) / 10));
        weightLabel.textContent = `${Math.round(kg)}kg`;
        weightLabel.setAttribute('transform', `rotate(${-a}, 0, 4)`); // label stays level
      } else {
        weight.setAttribute('opacity', 0);
      }
    }
  }

  set({ angle: 0 });
  return { svg, set };
}

// ─────────────────────────── front figure ───────────────────────────
// Knobs: tilt (° ear-to-shoulder, +right), turn (−1..1 look left/right),
// lift {l,r} px shoulder raise, armsUp (0..1), mood.
export function createFrontFigure(container, { showEarShoulderDots = false } = {}) {
  const svg = el('svg', { viewBox: '0 0 320 270', role: 'img', 'aria-label': 'Front view figure' });

  el('ellipse', { cx: 160, cy: 258, rx: 100, ry: 10, fill: 'rgba(46,42,59,.07)' }, svg);

  // arms (behind torso), animatable for sky-reach
  const armL = el('path', { d: '', stroke: SKIN, 'stroke-width': 16, 'stroke-linecap': 'round', fill: 'none' }, svg);
  const armR = el('path', { d: '', stroke: SKIN, 'stroke-width': 16, 'stroke-linecap': 'round', fill: 'none' }, svg);

  // shoulder groups (shift up for shrugs/rolls)
  const shoulders = el('g', {}, svg);
  el('path', {
    d: 'M 92 258 Q 88 196 122 186 L 198 186 Q 232 196 228 258 Z',
    fill: SHIRT,
  }, shoulders);
  // shoulder top markers
  const shL = el('circle', { cx: 112, cy: 190, r: showEarShoulderDots ? 7 : 0, fill: '#7C5CE0' }, shoulders);
  const shR = el('circle', { cx: 208, cy: 190, r: showEarShoulderDots ? 7 : 0, fill: '#7C5CE0' }, shoulders);

  const PIVOT = { x: 160, y: 188 };

  // head group
  const head = el('g', {}, svg);
  el('rect', { x: 148, y: 148, width: 24, height: 44, rx: 10, fill: SKIN }, head); // neck
  el('circle', { cx: 160, cy: 116, r: 42, fill: SKIN, stroke: SKIN_EDGE, 'stroke-width': 2.5 }, head);
  el('path', { // hair
    d: 'M 120 106 Q 122 66 160 66 Q 198 66 200 106 Q 186 84 160 84 Q 134 84 120 106',
    fill: INK,
  }, head);
  const earL = el('circle', { cx: 119, cy: 118, r: 6.5, fill: '#F5B98F' }, head);
  const earR = el('circle', { cx: 201, cy: 118, r: 6.5, fill: '#F5B98F' }, head);
  const face = el('g', {}, head);
  const eyeL = el('circle', { cx: 146, cy: 112, r: 4, fill: INK }, face);
  const eyeR = el('circle', { cx: 174, cy: 112, r: 4, fill: INK }, face);
  const mouthF = el('path', { d: 'M 150 134 Q 160 142 170 134', stroke: INK, 'stroke-width': 3, 'stroke-linecap': 'round', fill: 'none' }, face);

  if (showEarShoulderDots) {
    earL.setAttribute('stroke', '#7C5CE0'); earL.setAttribute('stroke-width', 2.5);
    earR.setAttribute('stroke', '#7C5CE0'); earR.setAttribute('stroke-width', 2.5);
  }

  container.appendChild(svg);

  function armPath(sx, sy, up, side) {
    // side: −1 left, +1 right. up: 0 hanging → 1 overhead
    const ex = sx + side * (30 - 52 * up);
    const ey = sy + 62 - 130 * up;
    const cx = sx + side * (34 - 10 * up);
    const cy = sy + 30 - 60 * up;
    return `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`;
  }

  function set({ tilt = 0, turn = 0, lift = { l: 0, r: 0 }, armsUp = null, mood = 'happy' } = {}) {
    head.setAttribute('transform', `rotate(${Math.max(-55, Math.min(55, tilt))}, ${PIVOT.x}, ${PIVOT.y})`);
    face.setAttribute('transform', `translate(${turn * 14}, 0)`);
    eyeL.setAttribute('cx', 146 + turn * 4);
    eyeR.setAttribute('cx', 174 + turn * 4);
    mouthF.setAttribute('d', mood === 'effort'
      ? 'M 151 136 Q 160 132 169 136'
      : 'M 150 134 Q 160 142 170 134');

    const lL = lift.l || 0, lR = lift.r || 0;
    shL.setAttribute('cy', 190 - lL);
    shR.setAttribute('cy', 190 - lR);
    shoulders.setAttribute('transform', `translate(0, ${-(lL + lR) / 4})`);

    if (armsUp == null) {
      armL.setAttribute('d', armPath(112, 200 - lL, 0, -1));
      armR.setAttribute('d', armPath(208, 200 - lR, 0, 1));
    } else {
      armL.setAttribute('d', armPath(112, 200 - lL, armsUp, -1));
      armR.setAttribute('d', armPath(208, 200 - lR, armsUp, 1));
    }
  }

  set({});
  return { svg, set, refs: { earL, earR, shL, shR, PIVOT } };
}

// Shared rAF ticker for looping demo animations (exercise cards & player).
const tickers = new Set();
let rafId = null;

function loop(ts) {
  // Isolate a throwing ticker: without this, one exception aborts the loop
  // before rafId is reassigned, leaving it truthy so addTicker never restarts
  // it — every animation freezes permanently until reload.
  for (const t of tickers) { try { t(ts / 1000); } catch { /* keep the loop alive */ } }
  rafId = tickers.size ? requestAnimationFrame(loop) : null;
}

export function addTicker(fn) {
  tickers.add(fn);
  if (!rafId) rafId = requestAnimationFrame(loop);
  return () => {
    tickers.delete(fn);
    if (!tickers.size && rafId) { cancelAnimationFrame(rafId); rafId = null; }
  };
}
