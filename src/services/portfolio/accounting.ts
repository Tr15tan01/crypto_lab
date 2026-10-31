import { ValidationError, AppError } from "@/lib/errors";
import { roundQty, roundQuote } from "@/lib/utils/math";

/**
 * Paper-trading accounting — AVERAGE COST BASIS.
 *
 * Buying
 *   gross     = amount the user chooses to invest (quote currency, e.g. USDT)
 *   fee       = gross × feeRate
 *   total     = gross + fee                    → deducted from virtual cash
 *   quantity  = gross ÷ price
 *   The fee is capitalised into the cost basis: investedValue += total,
 *   averageCost = investedValue ÷ quantity.
 *
 * Selling
 *   gross         = quantity × price
 *   fee           = gross × feeRate
 *   proceeds      = gross − fee                → added to virtual cash
 *   costBasisSold = averageCost × quantity     (the whole remaining basis when closing a position)
 *   realizedPnL   = proceeds − costBasisSold
 *   averageCost of the remaining quantity is unchanged.
 *
 * Rounding: quote amounts to 8 dp, quantities to 10 dp. A remainder below DUST after a sale
 * closes the position, so no "ghost" balances are left behind.
 */
export const MIN_NOTIONAL = 1;
export const DUST = 1e-9;

export interface PositionState {
  quantity: number;
  investedValue: number;
  averageCost: number;
  realizedPnL: number;
}

export const EMPTY_POSITION: PositionState = { quantity: 0, investedValue: 0, averageCost: 0, realizedPnL: 0 };

export interface BuyComputation {
  quantity: number;
  grossAmount: number;
  fee: number;
  total: number;
  averageCostBefore: number;
  position: PositionState;
}

export interface SellComputation {
  quantity: number;
  grossAmount: number;
  fee: number;
  total: number; // net proceeds
  costBasisSold: number;
  realizedPnL: number;
  returnPercent: number | null;
  averageCostBefore: number;
  position: PositionState;
}

function assertPositive(name: string, v: number) {
  if (!Number.isFinite(v) || v <= 0) throw new ValidationError(`${name} must be a positive number.`);
}

function assertFeeRate(rate: number) {
  if (!Number.isFinite(rate) || rate < 0 || rate > 5) throw new ValidationError("Fee rate must be between 0% and 5%.");
}

export function computeBuy(
  position: PositionState,
  input: { quoteAmount: number; price: number; feeRatePercent: number },
): BuyComputation {
  assertPositive("Amount", input.quoteAmount);
  assertPositive("Price", input.price);
  assertFeeRate(input.feeRatePercent);
  if (input.quoteAmount < MIN_NOTIONAL) {
    throw new ValidationError(`The minimum simulated order is ${MIN_NOTIONAL} in the quote currency.`);
  }

  const grossAmount = roundQuote(input.quoteAmount);
  const fee = roundQuote((grossAmount * input.feeRatePercent) / 100);
  const total = roundQuote(grossAmount + fee);
  const quantity = roundQty(grossAmount / input.price);
  if (quantity <= 0) throw new ValidationError("The amount is too small to buy any quantity at this price.");

  const newQty = roundQty(position.quantity + quantity);
  const newInvested = roundQuote(position.investedValue + total);
  return {
    quantity,
    grossAmount,
    fee,
    total,
    averageCostBefore: position.averageCost,
    position: {
      quantity: newQty,
      investedValue: newInvested,
      averageCost: newInvested / newQty,
      realizedPnL: position.realizedPnL,
    },
  };
}

export function computeSell(
  position: PositionState,
  input: { quantity?: number; sellAll?: boolean; price: number; feeRatePercent: number },
): SellComputation {
  assertPositive("Price", input.price);
  assertFeeRate(input.feeRatePercent);
  if (position.quantity <= 0) throw new AppError("CONFLICT", "There is no open position to sell.");

  let quantity: number;
  if (input.sellAll) {
    quantity = position.quantity;
  } else {
    assertPositive("Quantity", input.quantity ?? NaN);
    quantity = roundQty(input.quantity!);
    if (quantity > position.quantity + DUST) {
      throw new ValidationError("You cannot sell more than you hold.");
    }
    // Selling (almost) everything closes the position exactly.
    if (position.quantity - quantity < DUST) quantity = position.quantity;
  }

  const closing = quantity === position.quantity;
  const grossAmount = roundQuote(quantity * input.price);
  if (grossAmount < MIN_NOTIONAL && !closing) {
    throw new ValidationError(`The minimum simulated order is ${MIN_NOTIONAL} in the quote currency.`);
  }
  const fee = roundQuote((grossAmount * input.feeRatePercent) / 100);
  const total = roundQuote(grossAmount - fee);
  const costBasisSold = closing ? position.investedValue : roundQuote(position.averageCost * quantity);
  const realizedPnL = roundQuote(total - costBasisSold);
  const remainingQty = closing ? 0 : roundQty(position.quantity - quantity);

  return {
    quantity,
    grossAmount,
    fee,
    total,
    costBasisSold,
    realizedPnL,
    returnPercent: costBasisSold > 0 ? (realizedPnL / costBasisSold) * 100 : null,
    averageCostBefore: position.averageCost,
    position: {
      quantity: remainingQty,
      investedValue: remainingQty === 0 ? 0 : roundQuote(position.investedValue - costBasisSold),
      averageCost: remainingQty === 0 ? 0 : position.averageCost,
      realizedPnL: roundQuote(position.realizedPnL + realizedPnL),
    },
  };
}

/** Estimates shown in the buy/sell dialog before confirmation. */
export function previewBuy(quoteAmount: number, price: number, feeRatePercent: number) {
  const gross = roundQuote(quoteAmount);
  const fee = roundQuote((gross * feeRatePercent) / 100);
  return { quantity: price > 0 ? roundQty(gross / price) : 0, fee, total: roundQuote(gross + fee) };
}
