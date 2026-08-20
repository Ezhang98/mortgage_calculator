// Rate benchmark widget. Fetches the static data/rates.json committed by the
// update-rates GitHub Action (SPEC §7). Never calls FRED directly.

import { benchmarkSeries } from './loanTypes.js';

const STALE_DAYS = 21;
let cached = null;

export async function fetchRates(force = false) {
  if (cached && !force) return cached;
  const res = await fetch('data/rates.json?_=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error('rates.json fetch failed: ' + res.status);
  cached = await res.json();
  return cached;
}

function isStale(rates) {
  if (!rates?.updated) return true;
  const age = (Date.now() - new Date(rates.updated).getTime()) / 86400000;
  return !Number.isFinite(age) || age > STALE_DAYS;
}

export function renderBenchmark(el, rates, loanType, userRatePct) {
  const { id, exact } = benchmarkSeries(loanType);
  const s = rates?.series?.[id];
  if (!rates || isStale(rates) || !s || s.rate == null) {
    el.innerHTML =
      '<span class="muted">Benchmark unavailable — rate data is missing or more than ' +
      STALE_DAYS +
      ' days old. Run the “Update mortgage rates” GitHub Action (see INSTRUCTIONS.md).</span>';
    return;
  }
  const delta = userRatePct - s.rate;
  const dir = delta > 0.005 ? 'above' : delta < -0.005 ? 'below' : 'equal to';
  const deltaTxt =
    dir === 'equal to'
      ? 'matches'
      : `is ${Math.abs(delta).toFixed(2)} pts ${dir}`;
  el.innerHTML = `
    <strong>${s.rate.toFixed(2)}%</strong> — ${s.label}, week of ${s.asOf}
    ${exact ? '' : '<span class="muted">(closest benchmark for this loan type)</span>'}<br>
    Your rate ${deltaTxt} the national average.`;
}
