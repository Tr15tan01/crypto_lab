import type { AlertType } from "@/models";

export interface AlertRuleInput {
  type: AlertType;
  threshold: number;
  referencePrice: number | null;
}

export interface PositionInfo {
  averageCost: number;
  quantity: number;
}

/** Pure trigger logic, unit-tested. Returns null when the rule cannot be evaluated. */
export function isTriggered(alert: AlertRuleInput, price: number, position?: PositionInfo | null): boolean | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  switch (alert.type) {
    case "PRICE_ABOVE":
      return price >= alert.threshold;
    case "PRICE_BELOW":
      return price <= alert.threshold;
    case "CHANGE_UP_PERCENT":
      if (!alert.referencePrice) return null;
      return ((price - alert.referencePrice) / alert.referencePrice) * 100 >= alert.threshold;
    case "CHANGE_DOWN_PERCENT":
      if (!alert.referencePrice) return null;
      return ((alert.referencePrice - price) / alert.referencePrice) * 100 >= alert.threshold;
    case "POSITION_PROFIT_PERCENT":
      if (!position || position.quantity <= 0 || position.averageCost <= 0) return null;
      return ((price - position.averageCost) / position.averageCost) * 100 >= alert.threshold;
    case "POSITION_LOSS_PERCENT":
      if (!position || position.quantity <= 0 || position.averageCost <= 0) return null;
      return ((position.averageCost - price) / position.averageCost) * 100 >= alert.threshold;
    default:
      return null;
  }
}

export function describeAlert(type: AlertType, threshold: number, symbol: string): string {
  switch (type) {
    case "PRICE_ABOVE":
      return `${symbol} at or above ${threshold}`;
    case "PRICE_BELOW":
      return `${symbol} at or below ${threshold}`;
    case "CHANGE_UP_PERCENT":
      return `${symbol} up ${threshold}% from when the alert was set`;
    case "CHANGE_DOWN_PERCENT":
      return `${symbol} down ${threshold}% from when the alert was set`;
    case "POSITION_PROFIT_PERCENT":
      return `${symbol} position up ${threshold}% vs average cost`;
    case "POSITION_LOSS_PERCENT":
      return `${symbol} position down ${threshold}% vs average cost`;
  }
}
