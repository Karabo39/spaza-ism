function validPrecision(value: number, scale: number) {
  const scaled = value * scale;
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isSafeInteger(Math.round(scaled)) &&
    Math.abs(scaled - Math.round(scaled)) < 0.000001
  );
}

/** Display estimate only; the invoice RPC validates and calculates final totals. */
export function orderTotals(
  lines: { quantity: number; unit_price: number }[],
  discount: number,
  taxPercent: number,
) {
  // Accepted quantities use thousandths and prices cents. Integer arithmetic
  // matches PostgreSQL's half-up decimal rounding (e.g. 1.005 × R3 = R3.02).
  if (
    lines.some(
      (l) =>
        !validPrecision(l.quantity, 1000) ||
        !validPrecision(l.unit_price, 100) ||
        l.quantity < 0 ||
        l.unit_price < 0,
    )
  )
    return { subtotal: 0, discount: 0, tax: 0, total: 0, valid: false };
  const cents = lines.reduce(
    (sum, l) =>
      sum +
      (BigInt(Math.round(l.quantity * 1000)) *
        BigInt(Math.round(l.unit_price * 100)) +
        BigInt(500)) /
        BigInt(1000),
    BigInt(0),
  );
  const subtotal = Number(cents) / 100;
  const valid =
    validPrecision(discount, 100) &&
    discount >= 0 &&
    discount <= subtotal &&
    validPrecision(taxPercent, 100) &&
    taxPercent >= 0 &&
    taxPercent <= 100;
  const deductionCents = valid ? BigInt(Math.round(discount * 100)) : BigInt(0);
  const deduction = Number(deductionCents) / 100;
  const taxCents = valid
    ? ((cents - deductionCents) * BigInt(Math.round(taxPercent * 100)) +
        BigInt(5000)) /
      BigInt(10000)
    : BigInt(0);
  const tax = Number(taxCents) / 100;
  return {
    subtotal,
    discount: deduction,
    tax,
    total: Number(cents - deductionCents + taxCents) / 100,
    valid: valid && cents - deductionCents + taxCents <= BigInt(99999999999999),
  };
}
