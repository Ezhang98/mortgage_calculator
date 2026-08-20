// Household split math (SPEC §6 Tab 4). Pure — DOM wiring lives in main.js.

import { estimateTaxes } from './taxes.js';

// h: { people: [{id, name, incomeMode: 'salary'|'net2w', salaryAnnual, filing, preTaxMonthly,
//                netBiweekly, shareMode: 'pct'|'usd', shareValue}],
//      costs:  [{id, name, amount, split: 'even'|'custom'|'personal', pct: {personId: pct}, personId}] }
// mortgageMonthly: the monthly cost being split (all-in or P&I-only).
// incomeMode 'net2w' takes actual take-home pay per two weeks from payroll (26 paychecks/yr,
// annualized to monthly as ×26/12) and skips the tax estimate entirely.
export function computeHousehold(h, mortgageMonthly, taxData) {
  const people = h.people;
  const rows = people.map((person) => {
    const mortgage =
      person.shareMode === 'usd'
        ? person.shareValue || 0
        : (mortgageMonthly * (person.shareValue || 0)) / 100;
    if (person.incomeMode === 'net2w') {
      return {
        id: person.id,
        name: person.name || 'Person',
        fromPayroll: true,
        gross: null,
        preTax: null,
        taxes: null,
        takeHome: (Math.max(0, person.netBiweekly || 0) * 26) / 12,
        mortgage,
        other: 0,
        tax: null,
      };
    }
    const tax = estimateTaxes(person, taxData);
    return {
      id: person.id,
      name: person.name || 'Person',
      fromPayroll: false,
      gross: tax.grossMonthly,
      preTax: tax.preTaxAnnual / 12,
      taxes: tax.totalTaxMonthly,
      takeHome: tax.takeHomeMonthly,
      mortgage,
      other: 0,
      tax,
    };
  });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  for (const cost of h.costs) {
    const amount = cost.amount || 0;
    if (amount <= 0 || rows.length === 0) continue;
    if (cost.split === 'personal') {
      const r = byId[cost.personId];
      if (r) r.other += amount;
      else rows.forEach((row) => { row.other += amount / rows.length; });
    } else if (cost.split === 'custom') {
      for (const r of rows) r.other += (amount * (cost.pct?.[r.id] || 0)) / 100;
    } else {
      for (const r of rows) r.other += amount / rows.length;
    }
  }

  for (const r of rows) r.spending = r.takeHome - r.mortgage - r.other;

  const shareTotal = rows.reduce((s, r) => s + r.mortgage, 0);
  return {
    rows,
    shareTotal,
    shareGap: mortgageMonthly - shareTotal, // >0 → uncovered, <0 → over-allocated
  };
}
