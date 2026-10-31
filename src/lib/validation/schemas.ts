import { z } from "zod";

/** Shared input schemas for API routes and server actions. */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .optional()
    .transform((v) => (v ? v : undefined));

/** For edits, an empty string clears a field (undefined means "unchanged"). */
const editableText = (max: number) => z.string().trim().max(max).optional();

const optionalPositive = z
  .union([z.number(), z.null()])
  .optional()
  .refine((v) => v === undefined || v === null || (Number.isFinite(v) && v > 0), "Must be a positive number");

export const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,20}$/, "Invalid trading pair");

export const idSchema = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");

export const idempotencyKeySchema = z.string().min(16).max(64).regex(/^[A-Za-z0-9-]+$/);

export const decisionTypeSchema = z.enum(["BUY", "SELL", "HOLD", "WATCH", "SKIP"]);
export const timeHorizonSchema = z.enum(["intraday", "days", "weeks", "months", "years"]);
export const riskLevelSchema = z.enum(["low", "medium", "high", "very_high"]);

export const journalFieldsSchema = z.object({
  thesis: text(4000),
  reason: text(2000),
  targetPrice: optionalPositive,
  expectedTimeHorizon: timeHorizonSchema.nullable().optional(),
  riskLevel: riskLevelSchema.nullable().optional(),
  riskAssessment: text(2000),
  confidence: z.number().int().min(1).max(10).nullable().optional(),
  notes: text(4000),
  aiResearchId: idSchema.nullable().optional(),
});
export type JournalFields = Partial<z.infer<typeof journalFieldsSchema>>;

export const buySchema = z.object({
  symbol: symbolSchema,
  quoteAmount: z.number().positive().max(1e12),
  idempotencyKey: idempotencyKeySchema,
  expectedPrice: z.number().positive().optional(),
  acknowledgeStale: z.boolean().optional(),
  journal: journalFieldsSchema.optional(),
});

export const sellSchema = z
  .object({
    symbol: symbolSchema,
    quantity: z.number().positive().optional(),
    sellAll: z.boolean().optional(),
    idempotencyKey: idempotencyKeySchema,
    expectedPrice: z.number().positive().optional(),
    acknowledgeStale: z.boolean().optional(),
    journal: journalFieldsSchema.optional(),
  })
  .refine((v) => v.sellAll || v.quantity !== undefined, "Enter a quantity or choose to sell everything");

export const executionStatusSchema = z.enum(["NOT_EXECUTED", "EXECUTED", "PARTIALLY_EXECUTED", "CANCELLED"]);

export const executionUpdateSchema = z
  .object({
    status: executionStatusSchema,
    details: z
      .object({
        price: optionalPositive,
        quantity: optionalPositive,
        fee: z.number().min(0).nullable().optional(),
        feeAsset: z.string().trim().max(12).nullable().optional(),
        executedAt: z.iso.datetime({ offset: true }).nullable().optional(),
        orderReference: z.string().trim().max(64).nullable().optional(),
      })
      .optional(),
    note: text(500),
  })
  .refine(
    (v) => !(v.status === "EXECUTED" || v.status === "PARTIALLY_EXECUTED") || (v.details?.price && v.details?.quantity),
    "Enter the actual price and quantity for an executed trade",
  );

export const portfolioConfigSchema = z.object({
  initialBalance: z.number().min(10).max(1e9),
  quoteAsset: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/),
  feeEnabled: z.boolean(),
  feeRatePercent: z.number().min(0).max(5),
  confirmReset: z.literal(true),
});

export const feeConfigSchema = z.object({
  feeEnabled: z.boolean(),
  feeRatePercent: z.number().min(0).max(5),
});

export const watchlistAddSchema = z.object({
  symbol: symbolSchema,
  reason: text(2000),
  notes: text(4000),
  targetPrice: optionalPositive,
});

export const watchlistUpdateSchema = z.object({
  reason: editableText(2000),
  notes: editableText(4000),
  targetPrice: optionalPositive,
  personalRanking: z.number().int().min(1).max(10).nullable().optional(),
});

export const alertTypeSchema = z.enum([
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "CHANGE_UP_PERCENT",
  "CHANGE_DOWN_PERCENT",
  "POSITION_PROFIT_PERCENT",
  "POSITION_LOSS_PERCENT",
]);

export const alertCreateSchema = z.object({
  symbol: symbolSchema,
  type: alertTypeSchema,
  threshold: z.number().positive().max(1e12),
  note: text(300),
});

export const journalCreateSchema = journalFieldsSchema.extend({
  symbol: symbolSchema,
  decisionType: decisionTypeSchema,
});

export const journalUpdateSchema = z.object({
  thesis: editableText(4000),
  reason: editableText(2000),
  targetPrice: optionalPositive,
  expectedTimeHorizon: timeHorizonSchema.nullable().optional(),
  riskLevel: riskLevelSchema.nullable().optional(),
  riskAssessment: editableText(2000),
  confidence: z.number().int().min(1).max(10).nullable().optional(),
  notes: editableText(4000),
});

export const journalReviewSchema = z.object({
  verdict: z.enum(["correct", "incorrect", "mixed", "too_early"]),
  notes: text(2000),
});
