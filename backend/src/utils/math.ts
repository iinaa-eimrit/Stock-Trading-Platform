export const UNIT_PRECISION = 1e8; // 8 decimal places for all balances

export function parsePriceToTicks(price: number, tickSize: number): number {
  if (price <= 0 || !Number.isFinite(price)) throw new Error("Price must be finite and positive");
  const priceScaled = Math.round(price * UNIT_PRECISION);
  const tickScaled = Math.round(tickSize * UNIT_PRECISION);
  if (priceScaled % tickScaled !== 0) throw new Error("Price not aligned to tick size");
  
  const ticks = priceScaled / tickScaled;
  if (!Number.isSafeInteger(ticks)) throw new Error("Price exceeds safe integer limit");
  return ticks;
}

export function parseQuantityToLots(quantity: number, lotSize: number): number {
  if (quantity <= 0 || !Number.isFinite(quantity)) throw new Error("Quantity must be finite and positive");
  const qtyScaled = Math.round(quantity * UNIT_PRECISION);
  const lotScaled = Math.round(lotSize * UNIT_PRECISION);
  if (qtyScaled % lotScaled !== 0) throw new Error("Quantity not aligned to lot size");
  
  const lots = qtyScaled / lotScaled;
  if (!Number.isSafeInteger(lots)) throw new Error("Quantity exceeds safe integer limit");
  return lots;
}

/**
 * Converts internal quantityLots into the 8-decimal integer base asset amount.
 */
export function lotsToBaseUnits(quantityLots: number, lotSize: number): number {
  const lotScaled = Math.round(lotSize * UNIT_PRECISION);
  return quantityLots * lotScaled;
}

/**
 * Converts internal priceTicks and quantityLots into the 8-decimal integer quote asset amount.
 */
export function ticksAndLotsToQuoteUnits(priceTicks: number, quantityLots: number, tickSize: number, lotSize: number): number {
  // tickSize * lotSize * 1e8
  const multiplierFloat = tickSize * lotSize * UNIT_PRECISION;
  const multiplier = Math.round(multiplierFloat);
  
  // Sanity check for float precision issues on the config
  if (Math.abs(multiplierFloat - multiplier) > 1e-9) {
    throw new Error("Invalid market config: tickSize * lotSize must cleanly representable");
  }

  const quoteUnits = priceTicks * quantityLots * multiplier;
  if (!Number.isSafeInteger(quoteUnits)) throw new Error("Quote units exceed safe integer limit");
  return quoteUnits;
}
