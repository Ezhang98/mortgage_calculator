// Pure amortization engine — no DOM, no fetch. All config is passed in.
// See SPEC.md §4–§5 for the rules implemented here.

import { LOAN_TYPES } from './loanTypes.js';

export function monthlyPayment(principal, annualRatePct, months) {
  const r = annualRatePct / 100 / 12;
  if (months <= 0) return 0;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

// Normalized profile inputs (all numbers; null = "auto" where noted):
// homePrice, downDollars, ratePct (zero-point base rate), loanType,
// armPostRatePct (null → ratePct + 2), points, pointReductionPct,
// propTaxPct, assessedGrowthPct, insuranceAnnual, hoaMonthly, melloRoosAnnual,
// pmiRatePct, fhaAnnualMipPct (null → auto from limits), fhaFinanceUpfront,
// vaFundingFeePct (null → limits first-use), vaExempt, vaFinanceFee,
// extraMonthly, extraOnceAmount, extraOnceMonth

export function effectiveRate(p) {
  return Math.max(0, p.ratePct - (p.points || 0) * (p.pointReductionPct ?? 0.25));
}

export function resolveLoan(p, limits) {
  const lt = LOAN_TYPES[p.loanType];
  const baseLoan = Math.max(0, (p.homePrice || 0) - (p.downDollars || 0));
  const ltv = p.homePrice > 0 ? baseLoan / p.homePrice : 0;
  const downPct = p.homePrice > 0 ? ((p.downDollars || 0) / p.homePrice) * 100 : 0;

  let financedFees = 0;
  let upfrontFees = 0;
  let feeLabel = null;
  if (lt.kind === 'fha') {
    const fee = (baseLoan * limits.fha.upfrontMipPct) / 100;
    feeLabel = `FHA upfront MIP (${limits.fha.upfrontMipPct}%)`;
    if (p.fhaFinanceUpfront !== false) financedFees += fee;
    else upfrontFees += fee;
  } else if (lt.kind === 'va' && !p.vaExempt) {
    const pct = p.vaFundingFeePct ?? limits.va.fundingFeeFirstUsePct;
    const fee = (baseLoan * pct) / 100;
    feeLabel = `VA funding fee (${pct}%)`;
    if (p.vaFinanceFee !== false) financedFees += fee;
    else upfrontFees += fee;
  }

  const principal = baseLoan + financedFees;
  const pointsCost = ((p.points || 0) / 100) * principal;
  return { lt, baseLoan, ltv, downPct, financedFees, upfrontFees, feeLabel, principal, pointsCost };
}

export function fhaAutoAnnualMip(ltv, limits) {
  return ltv > 0.95 ? limits.fha.annualMipPct.ltvOver95 : limits.fha.annualMipPct.ltvUpTo95;
}

// opts.postRateOverride: forces the ARM post-fixed rate (used for best/worst band).
export function buildSchedule(p, limits, opts = {}) {
  const { lt, baseLoan, ltv, downPct, financedFees, upfrontFees, principal, pointsCost } =
    resolveLoan(p, limits);
  const term = lt.termMonths;
  const fixedMonths = lt.fixedMonths ?? null;

  const initRate = effectiveRate(p);
  const postRate = fixedMonths
    ? Math.max(0, opts.postRateOverride ?? p.armPostRatePct ?? p.ratePct + 2)
    : null;

  const pmiActive = lt.kind === 'conventional' && downPct < 20 && (p.pmiRatePct || 0) > 0;
  const fhaAnnual =
    lt.kind === 'fha' ? (p.fhaAnnualMipPct ?? fhaAutoAnnualMip(ltv, limits)) : 0;
  const fhaLife = ltv > 0.9; // down < 10% → MIP for life of loan
  const fhaCancelMonths = limits.fha.cancelMonthsIfDownAtLeast10 ?? 132;

  let balance = principal;
  let rate = initRate;
  let mr = rate / 100 / 12;
  const initPayment = monthlyPayment(balance, rate, term);
  let payment = initPayment;

  const months = [];
  let cumPI = pointsCost + upfrontFees;
  let cumAllIn = pointsCost + upfrontFees;
  let totalInterest = 0;
  let totalMI = 0;
  let miEndMonth = null;

  for (let m = 1; m <= term && balance > 0.005; m++) {
    if (fixedMonths && m === fixedMonths + 1) {
      rate = postRate;
      mr = rate / 100 / 12;
      payment = monthlyPayment(balance, rate, term - fixedMonths);
    }
    const interest = balance * mr;
    let extra = p.extraMonthly || 0;
    if ((p.extraOnceAmount || 0) > 0 && m === (p.extraOnceMonth || 1)) extra += p.extraOnceAmount;
    const principalPaid = Math.min(payment - interest + extra, balance);
    const piPaid = interest + principalPaid;

    let mi = 0;
    if (pmiActive) {
      if (p.homePrice > 0 && balance / p.homePrice > 0.78) {
        mi = (balance * (p.pmiRatePct / 100)) / 12;
      } else if (miEndMonth === null) {
        miEndMonth = m;
      }
    } else if (lt.kind === 'fha' && fhaAnnual > 0) {
      if (fhaLife || m <= fhaCancelMonths) {
        mi = (balance * (fhaAnnual / 100)) / 12;
      } else if (miEndMonth === null) {
        miEndMonth = m;
      }
    }

    balance -= principalPaid;
    totalInterest += interest;
    totalMI += mi;

    const year = Math.floor((m - 1) / 12);
    const tax =
      ((p.homePrice || 0) * ((p.propTaxPct || 0) / 100) *
        Math.pow(1 + (p.assessedGrowthPct || 0) / 100, year)) / 12;
    const ins = (p.insuranceAnnual || 0) / 12;
    const hoa = p.hoaMonthly || 0;
    const mello = (p.melloRoosAnnual || 0) / 12;

    cumPI += piPaid;
    cumAllIn += piPaid + mi + tax + ins + hoa + mello;
    months.push({
      m, interest, principal: principalPaid, mi, tax, ins, hoa, mello,
      balance: Math.max(0, balance), cumPI, cumAllIn, ratePct: rate,
    });
  }

  const first = months[0] ?? { mi: 0, tax: 0, ins: 0, hoa: 0, mello: 0 };
  const payoffMonth = months.length;
  const summary = {
    baseLoan, principal, financedFees, upfrontFees, pointsCost,
    ltv, downPct,
    effRatePct: initRate,
    postRatePct: postRate,
    fixedMonths,
    monthlyPI: initPayment,
    firstMonthAllIn: initPayment + first.mi + first.tax + first.ins + first.hoa + first.mello,
    firstMonth: first,
    totalInterest, totalMI, miEndMonth,
    totalPI: cumPI, totalAllIn: cumAllIn,
    payoffMonth,
    termMonths: term,
  };
  return { months, summary };
}

// Compares the profile against the same profile at zero points.
// Returns null when no points are bought.
export function pointsBreakEven(p, limits) {
  if (!(p.points > 0)) return null;
  const withPts = buildSchedule(p, limits);
  const noPts = buildSchedule({ ...p, points: 0 }, limits);
  const n = Math.max(withPts.months.length, noPts.months.length);
  let breakEvenMonth = null;
  for (let i = 0; i < n; i++) {
    const w = withPts.months[Math.min(i, withPts.months.length - 1)].cumAllIn;
    const wo = noPts.months[Math.min(i, noPts.months.length - 1)].cumAllIn;
    if (w <= wo) { breakEvenMonth = i + 1; break; }
  }
  return {
    breakEvenMonth,
    savings: noPts.summary.totalAllIn - withPts.summary.totalAllIn,
    monthlySavings: noPts.summary.monthlyPI - withPts.summary.monthlyPI,
    withSchedule: withPts,
    withoutSchedule: noPts,
  };
}
