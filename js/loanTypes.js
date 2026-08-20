// Loan type metadata. Per-type mechanics (MI, fees, ARM adjustment) live in amortization.js.

export const LOAN_TYPES = {
  '30fixed': { label: '30-year fixed', termMonths: 360, kind: 'conventional' },
  '20fixed': { label: '20-year fixed', termMonths: 240, kind: 'conventional' },
  '15fixed': { label: '15-year fixed', termMonths: 180, kind: 'conventional' },
  '10fixed': { label: '10-year fixed', termMonths: 120, kind: 'conventional' },
  arm5: { label: '5/1 ARM (30-yr)', termMonths: 360, kind: 'conventional', fixedMonths: 60 },
  arm7: { label: '7/1 ARM (30-yr)', termMonths: 360, kind: 'conventional', fixedMonths: 84 },
  arm10: { label: '10/1 ARM (30-yr)', termMonths: 360, kind: 'conventional', fixedMonths: 120 },
  fha30: { label: 'FHA 30-year', termMonths: 360, kind: 'fha' },
  va30: { label: 'VA 30-year', termMonths: 360, kind: 'va' },
};

export function isArm(loanType) {
  return Boolean(LOAN_TYPES[loanType]?.fixedMonths);
}

// Maps a loan type to the closest PMMS benchmark series (SPEC §7).
export function benchmarkSeries(loanType) {
  if (loanType === '15fixed' || loanType === '10fixed') {
    return { id: 'MORTGAGE15US', exact: loanType === '15fixed' };
  }
  return { id: 'MORTGAGE30US', exact: loanType === '30fixed' };
}
