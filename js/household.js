// Household split math (SPEC §6 Tab 4). Pure — DOM wiring lives in main.js.

import { estimateTaxes } from './taxes.js';

// h: { people: [{id, name, salaryAnnual, filing, preTaxMonthly, shareMode: 'pct'|'usd', shareValue}],
//      costs:  [{id, name, amount, split: 'even'|'custom'|'personal', pct: {personId: pct}, personId}] }
// mortgageMonthly: the monthly cost being split (all-in or P&I-only).
export function computeHousehold(h, mortgageMonthly, taxData) {
  const people = h.people;
  const rows = people.map((person) => {
    const tax = estimateTaxes(person, taxData);
    const mortgage =
      person.shareMode === 'usd'
        ? person.shareValue || 0
        : (mortgageMonthly * (person.shareValue || 0)) / 100;
    return {
      id: person.id,
      name: person.name || 'Person',
      gross: tax.grossMonthly,
      preTax: person.preTaxMonthly || 0,
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
