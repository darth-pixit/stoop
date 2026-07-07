// Small hand-rolled SVG chart kit: line/area chart with crosshair + tooltip.
// Marks follow the house dataviz rules: 2px lines, recessive hairline grid,
// direct label on the latest point, tooltips on hover — never a number on
// every point.

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

const tooltip = () => document.getElementById('viz-tooltip');

export function showTooltip(html, clientX, clientY) {
  const tt = tooltip();
  tt.innerHTML = html;
  tt.classList.remove('hidden');
  const r = tt.getBoundingClientRect();
  let x = clientX + 14, y = clientY - r.height - 10;
  if (x + r.width > window.innerWidth - 8) x = clientX - r.width - 14;
  if (y < 8) y = clientY + 16;
  tt.style.left = `${x}px`;
  tt.style.top = `${y}px`;
}

export function hideTooltip() {
  tooltip().classList.add('hidden');
}

// series: [{ name, color, points: [{ v, label, sub }] }] — all series share x slots.
// xTicks: strings under the axis (sparse ok: null to skip a slot).
export function lineChart(container, { series, xTicks, yFmt = (v) => v, height = 170, yMax = null, annotate = true }) {
  container.innerHTML = '';
  const W = 440, H = height;
  const pad = { l: 8, r: 42, t: 14, b: 22 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'false' });

  const slots = series[0].points.length;
  const allVals = series.flatMap((s) => s.points.map((p) => p.v)).filter((v) => v != null);
  const max = yMax ?? Math.max(1e-9, ...allVals) * 1.15;
  const x = (i) => pad.l + (slots === 1 ? 0.5 : i / (slots - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);

  // hairline grid: 3 recessive horizontals
  for (let g = 0; g <= 2; g++) {
    const gy = pad.t + (g / 2) * (H - pad.t - pad.b);
    el('line', { x1: pad.l, x2: W - pad.r, y1: gy, y2: gy, stroke: '#ECE7DE', 'stroke-width': 1 }, svg);
  }
  // baseline
  el('line', { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b, stroke: '#C9C3B8', 'stroke-width': 1.5 }, svg);

  for (const s of series) {
    const pts = s.points.map((p, i) => (p.v == null ? null : [x(i), y(p.v)]));
    const seg = pts.filter(Boolean);
    if (!seg.length) continue;
    const d = pts.reduce((acc, p, i) => {
      if (!p) return acc;
      const prev = i > 0 && pts[i - 1];
      return acc + (prev ? ` L ${p[0]} ${p[1]}` : ` M ${p[0]} ${p[1]}`);
    }, '');
    if (series.length === 1) {
      // single series gets a soft area under the line
      const first = seg[0], last = seg[seg.length - 1];
      el('path', {
        d: `${d} L ${last[0]} ${H - pad.b} L ${first[0]} ${H - pad.b} Z`,
        fill: s.color, opacity: 0.09,
      }, svg);
    }
    el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);

    // direct label + dot on the latest real point
    let lastIdx = -1;
    s.points.forEach((p, i) => { if (p.v != null) lastIdx = i; });
    if (annotate && lastIdx >= 0) {
      const px = x(lastIdx), py = y(s.points[lastIdx].v);
      el('circle', { cx: px, cy: py, r: 4.5, fill: s.color, stroke: '#fff', 'stroke-width': 2 }, svg);
      el('text', {
        x: px + 7, y: py + 4, fill: '#2E2A3B', 'font-size': 12, 'font-weight': 800, 'font-family': 'inherit',
      }, svg).textContent = yFmt(s.points[lastIdx].v);
    }
  }

  // x tick labels
  if (xTicks) {
    xTicks.forEach((t, i) => {
      if (t == null) return;
      el('text', {
        x: x(i), y: H - 6, 'text-anchor': 'middle', fill: '#9B95A8',
        'font-size': 10.5, 'font-weight': 700, 'font-family': 'inherit',
      }, svg).textContent = t;
    });
  }

  // hover layer: crosshair + shared tooltip across series
  const cross = el('line', { y1: pad.t, y2: H - pad.b, stroke: '#9B95A8', 'stroke-width': 1, 'stroke-dasharray': '2 4', opacity: 0 }, svg);
  const hoverDots = series.map((s) => el('circle', { r: 5, fill: s.color, stroke: '#fff', 'stroke-width': 2, opacity: 0 }, svg));

  function onMove(ev) {
    const rect = svg.getBoundingClientRect();
    const relX = ((ev.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((relX - pad.l) / (W - pad.l - pad.r)) * (slots - 1));
    if (i < 0 || i >= slots) return onLeave();
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    cross.setAttribute('opacity', 0.6);
    const rows = [];
    series.forEach((s, si) => {
      const p = s.points[i];
      if (p && p.v != null) {
        hoverDots[si].setAttribute('cx', x(i));
        hoverDots[si].setAttribute('cy', y(p.v));
        hoverDots[si].setAttribute('opacity', 1);
        rows.push(`${series.length > 1 ? `${s.name}: ` : ''}<b>${yFmt(p.v)}</b>${p.sub ? ` <span class="tt-sub">${p.sub}</span>` : ''}`);
      } else {
        hoverDots[si].setAttribute('opacity', 0);
      }
    });
    const label = series[0].points[i]?.label || '';
    if (rows.length) showTooltip(`${label ? `${label}<br>` : ''}${rows.join('<br>')}`, ev.clientX, ev.clientY);
    else hideTooltip();
  }

  function onLeave() {
    cross.setAttribute('opacity', 0);
    hoverDots.forEach((d) => d.setAttribute('opacity', 0));
    hideTooltip();
  }

  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerdown', onMove);
  svg.addEventListener('pointerleave', onLeave);

  container.appendChild(svg);
  return svg;
}
