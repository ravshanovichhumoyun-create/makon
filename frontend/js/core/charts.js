// Charts rendered as HTML/CSS (crisp at any width, no library).
// Marks follow fixed specs: columns ≤ 24px with 4px rounded data-ends, 2px surface gaps,
// hairline grid, a hover/tap tooltip on every mark, text in ink colours (never the series colour).
import { html } from './dom.js';
import { compact, money, t } from './i18n.js';

// Validated categorical palette: light step → dark step.
const DARK_STEP = {
  '#2a78d6': '#3987e5', '#eb6834': '#d95926', '#1baf7a': '#199e70', '#eda100': '#c98500',
  '#e87ba4': '#d55181', '#008300': '#0ca30c', '#6250d6': '#9085e9', '#e34948': '#e66767',
  '#8d6e63': '#a1887f', '#0e7490': '#22a5c4', '#898781': '#898781',
};

export const isDark = () => document.documentElement.dataset.resolvedTheme === 'dark';

export function seriesColor(hex) {
  const h = String(hex || '#898781').toLowerCase();
  return isDark() ? DARK_STEP[h] || h : h;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

function axis(max) {
  const ticks = [max, max / 2, 0];
  return html`<div class="ch-axis" aria-hidden="true">${ticks.map((v) => html`<span>${compact(v)}</span>`)}</div>
    <div class="ch-grid" aria-hidden="true"><i></i><i></i><i></i></div>`;
}

/**
 * Column chart. data: [{ key, value, label, tip, future }]
 * opts: { color, avg, highlight (key), height, labelEvery }
 */
export function columns(data, { color = 'var(--series-1)', avg = 0, highlight = null, height = 168, labelEvery = 1, ariaLabel = '' } = {}) {
  const max = niceMax(Math.max(avg, ...data.map((d) => d.value), 0));
  const avgPct = avg > 0 ? (avg / max) * 100 : 0;
  return html`
    <div class="chart" style="--h:${height}px" role="img" aria-label="${ariaLabel}">
      ${axis(max)}
      <div class="ch-plot">
        ${avg > 0 ? html`<div class="ch-ref" style="bottom:${avgPct}%"><span>${t('chart.avg')} ${compact(avg)}</span></div>` : ''}
        <div class="ch-cols">
          ${data.map((d, i) => html`
            <div class="ch-slot ${d.key === highlight ? 'is-hl' : ''} ${d.future ? 'is-future' : ''}" tabindex="0" data-tip="${d.tip}: ${money(d.value)}">
              <div class="ch-bar" style="height:${d.value > 0 ? Math.max(2, (d.value / max) * 100) : 0}%;background:${color}"></div>
            </div>`)}
        </div>
        <div class="ch-labels" aria-hidden="true">
          ${data.map((d, i) => {
            const hl = data.findIndex((x) => x.key === highlight);
            const show = d.key === highlight || (i % labelEvery === 0 && (hl < 0 || labelEvery === 1 || Math.abs(i - hl) > 1));
            return html`<span class="${show ? '' : 'is-hidden'} ${d.key === highlight ? 'is-hl' : ''}">${d.label}</span>`;
          })}
        </div>
      </div>
    </div>`;
}

/**
 * Grouped columns for two series on one shared scale. rows: [{ key, label, tip, a, b }]
 * series: [{ field, name, color }]
 */
export function grouped(rows, series, { height = 168, highlight = null, ariaLabel = '' } = {}) {
  const max = niceMax(Math.max(0, ...rows.flatMap((r) => series.map((s) => r[s.field]))));
  return html`
    <div class="legend">${series.map((s) => html`<span class="lg-item"><i class="lg-swatch" style="background:${s.color}"></i>${s.name}</span>`)}</div>
    <div class="chart" style="--h:${height}px" role="img" aria-label="${ariaLabel}">
      ${axis(max)}
      <div class="ch-plot">
        <div class="ch-cols">
          ${rows.map((r) => html`
            <div class="ch-slot ch-group ${r.key === highlight ? 'is-hl' : ''}" tabindex="0"
                 data-tip="${r.tip}: ${series.map((s) => `${s.name} ${money(r[s.field])}`).join(' · ')}">
              ${series.map((s) => html`<div class="ch-bar" style="height:${r[s.field] > 0 ? Math.max(2, (r[s.field] / max) * 100) : 0}%;background:${s.color}"></div>`)}
            </div>`)}
        </div>
        <div class="ch-labels" aria-hidden="true">${rows.map((r) => html`<span class="${r.key === highlight ? 'is-hl' : ''}">${r.label}</span>`)}</div>
      </div>
    </div>`;
}

/** One whole split into ≤ 6 parts. parts: [{ id, label, value, color }] */
export function segmentBar(parts, { ariaLabel = '' } = {}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return html`<div class="segbar is-empty"></div>`;
  return html`
    <div class="segbar" role="img" aria-label="${ariaLabel}">
      ${parts.map((p) => html`<div class="seg-part" style="flex:${p.value} 1 0;background:${p.color}" data-tip="${p.label}: ${money(p.value)} · ${Math.round((p.value / total) * 100)}%"></div>`)}
    </div>`;
}

/** Meter: value against a limit; fill colour carries the state, track is a lighter step of the same ramp. */
export function meter(value, limit, state = 'ok', { label = '' } = {}) {
  const pct = limit > 0 ? Math.min(100, (value / limit) * 100) : 0;
  return html`<div class="meter meter-${state}" role="meter" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${value}" aria-label="${label}">
    <div class="meter-fill" style="width:${pct}%"></div></div>`;
}

/** Plain progress bar (reading progress, subtasks, goals). */
export function progress(pct, { tone = 'accent' } = {}) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  return html`<div class="progress progress-${tone}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(v)}">
    <div class="progress-fill" style="width:${v}%"></div></div>`;
}
