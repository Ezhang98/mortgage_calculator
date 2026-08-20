// Chart.js wrappers. Colors come from CSS custom properties (set in style.css,
// light/dark aware) so charts re-render correctly when the theme changes.

/* global Chart */

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function seriesColor(i) {
  return cssVar(`--series-${(i % 8) + 1}`);
}

const fmtUSD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});
export const usd = (v) => fmtUSD.format(v);

function baseOptions(yLabel, xLabel) {
  const ink = cssVar('--text-secondary');
  const grid = cssVar('--gridline');
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    plugins: {
      legend: { labels: { color: ink, boxWidth: 14, boxHeight: 14 } },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${usd(ctx.parsed.y)}`,
          title: (items) => {
            const x = items[0]?.parsed?.x;
            return x != null ? `Year ${Number(x).toFixed(1)}` : '';
          },
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        title: { display: Boolean(xLabel), text: xLabel, color: ink },
        ticks: { color: ink },
        grid: { color: grid },
      },
      y: {
        title: { display: Boolean(yLabel), text: yLabel, color: ink },
        ticks: { color: ink, callback: (v) => usd(v) },
        grid: { color: grid },
        beginAtZero: true,
      },
    },
  };
}

function replaceChart(canvas, config) {
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  return new Chart(canvas, config);
}

// series: [{ label, color, points: [{x years, y $}], dashFromX?, thin?, markers?: [{x, y, label}] }]
export function renderCumulativeChart(canvas, series, { yLabel = 'Total paid ($)' } = {}) {
  const datasets = [];
  for (const s of series) {
    datasets.push({
      label: s.label,
      data: s.points,
      borderColor: s.color,
      backgroundColor: s.color,
      borderWidth: s.thin ? 1 : 2,
      borderDash: s.dashed ? [5, 4] : undefined,
      pointRadius: 0,
      pointHitRadius: 8,
      segment: s.dashFromX != null
        ? { borderDash: (ctx) => (ctx.p0.parsed.x >= s.dashFromX ? [5, 4] : undefined) }
        : undefined,
    });
    for (const mk of s.markers || []) {
      datasets.push({
        label: mk.label,
        data: [{ x: mk.x, y: mk.y }],
        type: 'scatter',
        pointStyle: mk.style || 'triangle',
        radius: 6,
        borderColor: s.color,
        backgroundColor: cssVar('--surface-1'),
        borderWidth: 2,
        showLine: false,
      });
    }
  }
  return replaceChart(canvas, {
    type: 'line',
    data: { datasets },
    options: baseOptions(yLabel, 'Years'),
  });
}

// Stacked area: where each month's payment goes (principal / interest / MI).
export function renderBreakdownChart(canvas, schedule) {
  const mk = (label, color, key) => ({
    label,
    data: schedule.months.map((row) => ({ x: row.m / 12, y: row[key] })),
    borderColor: color,
    backgroundColor: color + '55',
    borderWidth: 1.5,
    pointRadius: 0,
    pointHitRadius: 8,
    fill: true,
  });
  const datasets = [
    mk('Principal', seriesColor(0), 'principal'),
    mk('Interest', seriesColor(1), 'interest'),
  ];
  if (schedule.months.some((r) => r.mi > 0)) datasets.push(mk('Mortgage insurance', seriesColor(2), 'mi'));
  const options = baseOptions('Monthly amount ($)', 'Years');
  options.scales.y.stacked = true;
  options.plugins.tooltip.callbacks.label = (ctx) =>
    `${ctx.dataset.label}: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(ctx.parsed.y)}`;
  return replaceChart(canvas, { type: 'line', data: { datasets }, options });
}

// Stacked bars per person: taxes / mortgage share / other costs / spending money.
export function renderHouseholdChart(canvas, rows) {
  const labels = rows.map((r) => r.name);
  const mk = (label, color, key) => ({
    label,
    data: rows.map((r) => Math.max(0, r[key])),
    backgroundColor: color,
    borderColor: cssVar('--surface-1'),
    borderWidth: 2,
    borderRadius: 4,
  });
  const datasets = [
    mk('Taxes', seriesColor(1), 'taxes'),
    mk('Mortgage share', seriesColor(0), 'mortgage'),
    mk('Other costs', seriesColor(3), 'other'),
    mk('Spending money', seriesColor(2), 'spending'),
  ];
  const ink = cssVar('--text-secondary');
  const grid = cssVar('--gridline');
  return replaceChart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { labels: { color: ink, boxWidth: 14, boxHeight: 14 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${usd(ctx.parsed.y)}` } },
      },
      scales: {
        x: { stacked: true, ticks: { color: ink }, grid: { display: false } },
        y: {
          stacked: true, beginAtZero: true,
          title: { display: true, text: 'Monthly ($)', color: ink },
          ticks: { color: ink, callback: (v) => usd(v) },
          grid: { color: grid },
        },
      },
    },
  });
}
