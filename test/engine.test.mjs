import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { monthlyPayment, buildSchedule, pointsBreakEven } from '../js/amortization.js';
import { taxFromBrackets, estimateTaxes } from '../js/taxes.js';
import { computeHousehold } from '../js/household.js';

const limits = JSON.parse(readFileSync(new URL('../data/limits.json', import.meta.url)));
const taxData = JSON.parse(readFileSync(new URL('../data/tax.json', import.meta.url)));

const closeTo = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ~${expected}`);

const baseProfile = (over = {}) => ({
  homePrice: 500000,
  downDollars: 100000,
  ratePct: 6.5,
  loanType: '30fixed',
  armPostRatePct: null,
  points: 0,
  pointReductionPct: 0.25,
  propTaxPct: 1.15,
  assessedGrowthPct: 2,
  insuranceAnnual: 2000,
  hoaMonthly: 0,
  melloRoosAnnual: 0,
  pmiRatePct: 0.6,
  fhaAnnualMipPct: null,
  fhaFinanceUpfront: true,
  vaFundingFeePct: null,
  vaExempt: false,
  vaFinanceFee: true,
  extraMonthly: 0,
  extraOnceAmount: 0,
  extraOnceMonth: 12,
  ...over,
});

test('monthlyPayment matches known values', () => {
  closeTo(monthlyPayment(200000, 6, 360), 1199.1, 0.2, '200k @6% 30yr');
  closeTo(monthlyPayment(120000, 0, 120), 1000, 0.001, 'zero-rate loan');
});

test('30-yr fixed amortizes to zero over 360 months', () => {
  const { months, summary } = buildSchedule(baseProfile(), limits);
  assert.equal(months.length, 360);
  closeTo(months.at(-1).balance, 0, 0.01, 'final balance');
  closeTo(summary.totalPI, summary.monthlyPI * 360, 1, 'total P&I = payment × 360');
  closeTo(summary.totalInterest, summary.totalPI - 400000, 1, 'interest = paid − principal');
});

test('PMI charged under 20% down and drops at 78% LTV', () => {
  const p = baseProfile({ downDollars: 50000 }); // 10% down, loan 450k
  const { months, summary } = buildSchedule(p, limits);
  closeTo(months[0].mi, (450000 * 0.006) / 12, 0.5, 'first-month PMI');
  assert.ok(summary.miEndMonth > 12 && summary.miEndMonth < 360, 'PMI ends mid-loan');
  const endRow = months[summary.miEndMonth - 1];
  assert.equal(endRow.mi, 0, 'no PMI at drop month');
  assert.ok(months[summary.miEndMonth - 2].balance / 500000 <= 0.78 + 1e-9, 'dropped at 78% LTV');
  const p20 = baseProfile(); // 20% down
  assert.equal(buildSchedule(p20, limits).summary.totalMI, 0, 'no PMI at 20% down');
});

test('FHA finances upfront MIP and charges life-of-loan annual MIP under 10% down', () => {
  const p = baseProfile({ loanType: 'fha30', downDollars: 17500 }); // 3.5% down
  const { months, summary } = buildSchedule(p, limits);
  const baseLoan = 482500;
  const expectedPrincipal = baseLoan * (1 + limits.fha.upfrontMipPct / 100);
  closeTo(summary.principal, expectedPrincipal, 1, 'upfront MIP financed');
  closeTo(months[0].mi, (expectedPrincipal * 0.0055) / 12, 1, 'annual MIP at >95% LTV');
  assert.ok(months.at(-1).mi > 0, 'MIP lasts life of loan');
});

test('VA charges no monthly MI and finances the funding fee', () => {
  const p = baseProfile({ loanType: 'va30', downDollars: 0 });
  const { months, summary } = buildSchedule(p, limits);
  assert.equal(summary.totalMI, 0);
  closeTo(summary.principal, 500000 * 1.0215, 1, 'funding fee financed');
  const exempt = buildSchedule(baseProfile({ loanType: 'va30', downDollars: 0, vaExempt: true }), limits);
  closeTo(exempt.summary.principal, 500000, 0.01, 'exempt: no fee');
});

test('ARM adjusts rate and payment after the fixed period', () => {
  const p = baseProfile({ loanType: 'arm5', ratePct: 6 });
  const { months } = buildSchedule(p, limits);
  assert.equal(months[59].ratePct, 6, 'fixed period rate');
  assert.equal(months[60].ratePct, 8, 'default post rate = rate + 2');
  assert.ok(months[60].interest > months[59].interest, 'interest jumps at adjustment');
});

test('extra payments shorten the loan', () => {
  const { summary } = buildSchedule(baseProfile({ extraMonthly: 500 }), limits);
  assert.ok(summary.payoffMonth < 300, 'paid off early');
  const once = buildSchedule(baseProfile({ extraOnceAmount: 50000, extraOnceMonth: 12 }), limits);
  assert.ok(once.summary.payoffMonth < 360, 'one-time extra shortens loan');
});

test('points lower the rate, cost upfront, and break even mid-loan', () => {
  const p = baseProfile({ points: 1 });
  const { summary } = buildSchedule(p, limits);
  closeTo(summary.effRatePct, 6.25, 1e-9, 'effective rate after 1 point');
  closeTo(summary.pointsCost, 4000, 0.01, '1% of 400k loan');
  const be = pointsBreakEven(p, limits);
  assert.ok(be.breakEvenMonth > 12 && be.breakEvenMonth < 240, `break-even sane (got ${be.breakEvenMonth})`);
  assert.ok(be.savings > 0, 'points save money over full term');
  assert.ok(be.monthlySavings > 0, 'monthly payment drops');
});

test('federal bracket math matches hand computation', () => {
  const fed = taxData.federal.brackets.single;
  closeTo(taxFromBrackets(50000, fed), 5914.0, 0.5, 'single, $50k taxable (2025)');
  closeTo(taxFromBrackets(0, fed), 0, 0.001, 'zero taxable');
});

test('estimateTaxes for $100k single roughly matches hand computation', () => {
  const r = estimateTaxes({ salaryAnnual: 100000, filing: 'single', preTaxMonthly: 0 }, taxData);
  closeTo(r.federal, 13449.0, 2, 'federal');
  closeTo(r.state, 5327.14, 5, 'CA income tax');
});

test('estimateTaxes components are separated correctly', () => {
  const r = estimateTaxes({ salaryAnnual: 100000, filing: 'single', preTaxMonthly: 0 }, taxData);
  closeTo(r.sdi, 1200, 0.5, 'SDI 1.2%');
  closeTo(r.ss, 6200, 0.5, 'Social Security');
  closeTo(r.medicare, 1450, 0.5, 'Medicare');
  closeTo(r.takeHomeAnnual, 100000 - r.totalTax, 0.01, 'take-home = gross − tax');
});

test('household split allocates mortgage and costs', () => {
  const h = {
    people: [
      { id: 'a', name: 'A', salaryAnnual: 120000, filing: 'single', preTaxMonthly: 0, shareMode: 'pct', shareValue: 60 },
      { id: 'b', name: 'B', salaryAnnual: 80000, filing: 'single', preTaxMonthly: 0, shareMode: 'usd', shareValue: 1000 },
    ],
    costs: [
      { id: 'c1', name: 'Internet', amount: 100, split: 'even', pct: {}, personId: null },
      { id: 'c2', name: 'Car', amount: 400, split: 'personal', pct: {}, personId: 'b' },
      { id: 'c3', name: 'Utils', amount: 200, split: 'custom', pct: { a: 75, b: 25 }, personId: null },
    ],
  };
  const { rows, shareTotal, shareGap } = computeHousehold(h, 4000, taxData);
  closeTo(rows[0].mortgage, 2400, 0.01, 'A pays 60%');
  closeTo(rows[1].mortgage, 1000, 0.01, 'B pays fixed $1000');
  closeTo(shareTotal, 3400, 0.01, 'share total');
  closeTo(shareGap, 600, 0.01, 'uncovered gap');
  closeTo(rows[0].other, 50 + 150, 0.01, 'A: half internet + 75% utils');
  closeTo(rows[1].other, 50 + 400 + 50, 0.01, 'B: half internet + car + 25% utils');
  for (const r of rows) closeTo(r.spending, r.takeHome - r.mortgage - r.other, 0.01, 'spending identity');
});
