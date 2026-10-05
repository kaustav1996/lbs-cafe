/**
 * All money is integer paise. GST is charged on (subtotal - discount), split equally into
 * CGST and SGST, and the bill total is rounded to the nearest rupee with a round-off line.
 */
export interface Totals {
  subtotal: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  total: number;
}

export function computeTotals(subtotal: number, discount: number, gstRate: number): Totals {
  const d = Math.max(0, Math.min(Math.round(discount), subtotal));
  const taxable = subtotal - d;
  const half = Math.round((taxable * gstRate) / 2);
  const exact = taxable + half * 2;
  const total = Math.round(exact / 100) * 100;
  return { subtotal, discount: d, taxable, cgst: half, sgst: half, roundOff: total - exact, total };
}
