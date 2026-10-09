// Dependency-free SVG bar chart drawn at the container's real width, with a hover/tap tooltip.
import { esc } from './utils.js';

export const compact = (n) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(Math.round(n)));

// Rounds a maximum up to a readable axis value (1, 2, 2.5, 5, 10 × 10^n).
export function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

// items: [{ label, value, tip }]. tip(item) returns the tooltip HTML. highlightLast marks the final bar (e.g. today).
export function drawBarChart(box, items, { ariaLabel = 'Chart', tip = () => '', highlightLast = false, height = 190 } = {}) {
  const W = Math.max(280, box.clientWidth); const H = height;
  const m = { t: 22, r: 8, b: 26, l: 40 };
  const iw = W - m.l - m.r; const ih = H - m.t - m.b;
  const max = niceMax(Math.max(0, ...items.map((d) => d.value)));
  const band = iw / items.length; const bw = Math.min(36, band * 0.56);
  const y = (v) => m.t + ih - (v / max) * ih;
  const peak = items.reduce((a, d, i) => (d.value > items[a].value ? i : a), 0);
  const ticks = [0, max / 2, max];
  const barPath = (x, top, w, h) => {
    if (h <= 0) return '';
    const r = Math.min(4, h, w / 2);
    return `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${top + h} Z`;
  };
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(ariaLabel)}"><g class="grid">`;
  for (const t of ticks) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`;
  svg += '</g><g class="axis">';
  for (const t of ticks) svg += `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`;
  items.forEach((d, i) => {
    const cx = m.l + band * i + band / 2;
    const last = highlightLast && i === items.length - 1;
    svg += `<text x="${cx}" y="${H - 6}" text-anchor="middle" ${last ? 'font-weight="700"' : ''}>${esc(d.label)}</text>`;
  });
  svg += '</g>';
  items.forEach((d, i) => {
    const x = m.l + band * i + (band - bw) / 2; const top = y(d.value); const h = m.t + ih - top;
    svg += `<path class="bar" d="${barPath(x, top, bw, h)}" style="animation-delay:${i * 0.05}s"/>`;
    if ((i === peak || (highlightLast && i === items.length - 1)) && d.value > 0) svg += `<text class="val" x="${x + bw / 2}" y="${top - 6}" text-anchor="middle">${compact(d.value)}</text>`;
    svg += `<rect class="bar-hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}"/>`;
  });
  svg += '</svg><div class="viz-tip"></div>';
  box.innerHTML = svg;
  const tipEl = box.querySelector('.viz-tip');
  const show = (el) => {
    const d = items[+el.dataset.i];
    tipEl.innerHTML = tip(d);
    tipEl.style.left = `${(+el.getAttribute('x') + band / 2)}px`;
    tipEl.style.top = `${Math.max(14, y(d.value))}px`;
    tipEl.classList.add('show');
  };
  box.querySelectorAll('.bar-hit').forEach((el) => {
    el.addEventListener('mouseenter', () => show(el));
    el.addEventListener('click', () => show(el));
    el.addEventListener('mouseleave', () => tipEl.classList.remove('show'));
  });
}
