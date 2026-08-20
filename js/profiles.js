// Profile persistence (localStorage), share-URL codec, JSON export/import. SPEC §8.

const PROFILES_KEY = 'mortgage-calc:profiles:v1';
const HOUSEHOLD_KEY = 'mortgage-calc:household:v1';

export function loadProfiles() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveProfiles(list) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
}

export function addProfile(name, inputs) {
  const list = loadProfiles();
  const profile = {
    id: 'p' + Math.random().toString(36).slice(2, 10),
    name,
    createdAt: new Date().toISOString(),
    inputs: { ...inputs },
  };
  list.push(profile);
  saveProfiles(list);
  return profile;
}

export function updateProfile(id, patch) {
  const list = loadProfiles();
  const p = list.find((x) => x.id === id);
  if (p) Object.assign(p, patch);
  saveProfiles(list);
}

export function deleteProfile(id) {
  saveProfiles(loadProfiles().filter((x) => x.id !== id));
}

export function loadHousehold() {
  try {
    const raw = localStorage.getItem(HOUSEHOLD_KEY);
    const h = raw ? JSON.parse(raw) : null;
    if (h && Array.isArray(h.people) && Array.isArray(h.costs)) return h;
  } catch { /* fall through */ }
  return { people: [], costs: [{ id: 'c-internet', name: 'Internet', amount: 80, split: 'even', pct: {}, personId: null }] };
}

export function saveHousehold(h) {
  localStorage.setItem(HOUSEHOLD_KEY, JSON.stringify(h));
}

// ---- JSON export / import ----

export function exportAll() {
  return JSON.stringify(
    { format: 'mortgage-calc-export', version: 1, profiles: loadProfiles(), household: loadHousehold() },
    null,
    2
  );
}

export function importAll(jsonText) {
  const data = JSON.parse(jsonText);
  if (data.format !== 'mortgage-calc-export') throw new Error('Not a mortgage-calc export file.');
  if (Array.isArray(data.profiles)) {
    const existing = loadProfiles();
    const ids = new Set(existing.map((p) => p.id));
    for (const p of data.profiles) {
      if (!ids.has(p.id)) existing.push(p);
    }
    saveProfiles(existing);
  }
  if (data.household) saveHousehold(data.household);
  return { profiles: loadProfiles().length };
}

// ---- Share URL codec (compact query keys) ----

const SHARE_KEYS = {
  homePrice: 'hp', downMode: 'dm', downPercent: 'dp', downDollars: 'dd',
  ratePct: 'r', loanType: 'lt', armPostRatePct: 'ar',
  points: 'pt', pointReductionPct: 'pr',
  propTaxPct: 'tx', assessedGrowthPct: 'ag', insuranceAnnual: 'in',
  hoaMonthly: 'ho', melloRoosAnnual: 'mr', pmiRatePct: 'pm',
  fhaAnnualMipPct: 'fm', fhaFinanceUpfront: 'fu',
  vaFundingFeePct: 'vf', vaExempt: 'vx', vaFinanceFee: 'vc',
  extraMonthly: 'em', extraOnceAmount: 'eo', extraOnceMonth: 'en',
};
const SHARE_KEYS_REV = Object.fromEntries(Object.entries(SHARE_KEYS).map(([k, v]) => [v, k]));

export function encodeShareURL(inputs) {
  const params = new URLSearchParams();
  for (const [key, short] of Object.entries(SHARE_KEYS)) {
    const v = inputs[key];
    if (v === null || v === undefined || v === '') continue;
    params.set(short, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  const url = new URL(window.location.href);
  url.search = params.toString();
  url.hash = '';
  return url.toString();
}

export function decodeShareURL(search) {
  const params = new URLSearchParams(search);
  const out = {};
  let found = false;
  for (const [short, value] of params.entries()) {
    const key = SHARE_KEYS_REV[short];
    if (!key) continue;
    found = true;
    if (key === 'loanType' || key === 'downMode') out[key] = value;
    else if (['fhaFinanceUpfront', 'vaExempt', 'vaFinanceFee'].includes(key)) out[key] = value === '1';
    else {
      const n = Number(value);
      if (Number.isFinite(n)) out[key] = n;
    }
  }
  return found ? out : null;
}
