// Simplified federal + California + FICA estimate (SPEC §6 Tab 4).
// W-2 wage income, standard deduction, no credits/dependents/itemizing.
// Pure functions — tax parameters come from data/tax.json, passed in.

export function taxFromBrackets(taxable, brackets) {
  let tax = 0;
  let lower = 0;
  for (const [upper, ratePct] of brackets) {
    const cap = upper === null ? Infinity : upper;
    if (taxable <= lower) break;
    const slice = Math.min(taxable, cap) - lower;
    tax += (slice * ratePct) / 100;
    lower = cap;
  }
  return tax;
}

// person: { salaryAnnual, filing: 'single'|'mfj', preTaxMonthly }
// Returns annual amounts plus monthly take-home.
export function estimateTaxes(person, taxData) {
  const salary = Math.max(0, person.salaryAnnual || 0);
  const filing = person.filing === 'mfj' ? 'mfj' : 'single';
  const preTaxAnnual = Math.max(0, (person.preTaxMonthly || 0) * 12);
  const agi = Math.max(0, salary - preTaxAnnual);

  const fed = taxData.federal;
  const fedTaxable = Math.max(0, agi - fed.standardDeduction[filing]);
  const federal = taxFromBrackets(fedTaxable, fed.brackets[filing]);

  const ca = taxData.california;
  const caTaxable = Math.max(0, agi - ca.standardDeduction[filing]);
  let state = taxFromBrackets(caTaxable, ca.brackets[filing]);
  const mh = ca.mentalHealthSurcharge;
  if (mh && caTaxable > mh.threshold) {
    state += ((caTaxable - mh.threshold) * mh.ratePct) / 100;
  }
  const sdi = (salary * (ca.sdiRatePct || 0)) / 100;

  // FICA applies to gross wages (pre-tax 401k does not reduce it; we keep it simple).
  const f = taxData.fica;
  const ss = (Math.min(salary, f.ssWageBase) * f.ssRatePct) / 100;
  const medicare =
    (salary * f.medicareRatePct) / 100 +
    (Math.max(0, salary - f.addlMedicareThreshold[filing]) * f.addlMedicareRatePct) / 100;

  const totalTax = federal + state + sdi + ss + medicare;
  const takeHomeAnnual = salary - preTaxAnnual - totalTax;
  return {
    federal, state, sdi, ss, medicare, totalTax,
    preTaxAnnual,
    takeHomeAnnual,
    takeHomeMonthly: takeHomeAnnual / 12,
    totalTaxMonthly: totalTax / 12,
    grossMonthly: salary / 12,
  };
}
