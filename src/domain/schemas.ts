import { z } from "zod";
import { CURRENCY_CODES } from "./money";
import { ORDER_STATUSES } from "./status";

/**
 * Zod schemas for every API input. Amounts are validated here only for shape;
 * precise decimal validation (per-currency decimal places, bounds) happens in
 * `parseAmount`, which is the single money-parsing path.
 */

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD format")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
    );
  }, "Not a valid calendar date");

const amountInput = z.union([
  z.string().trim().min(1, "Amount is required"),
  z.number(),
]);

export const signupSchema = z.object({
  email: z.email("Invalid email address").toLowerCase(),
  // Upper bound matches bcrypt's 72-byte input limit (it would otherwise
  // truncate silently) and keeps hashing cost bounded.
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"),
});

export const loginSchema = z.object({
  email: z.email("Invalid email address").toLowerCase(),
  password: z.string().min(1, "Password is required"),
});

export const lineItemSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(200),
  quantity: z
    .number()
    .int("Quantity must be a whole number")
    .min(1, "Quantity must be at least 1")
    .max(1_000_000),
  unitPrice: amountInput,
});

export const createOrderSchema = z.object({
  customer: z.string().trim().min(1, "Customer is required").max(200),
  dueDate: dateString,
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]),
  lineItems: z
    .array(lineItemSchema)
    .min(1, "At least one line item is required")
    .max(100),
});

/** Currency is immutable after creation: payments already reference it. */
export const updateOrderSchema = z
  .object({
    customer: z.string().trim().min(1).max(200),
    dueDate: dateString,
    lineItems: z.array(lineItemSchema).min(1).max(100),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export const paymentSchema = z.object({
  amount: amountInput,
  date: dateString,
  note: z.string().trim().max(500).optional(),
});

export const refundSchema = paymentSchema;

export const listOrdersQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
});

export const exportQuerySchema = z
  .object({
    from: dateString.optional(),
    to: dateString.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "`from` must not be after `to`",
  });

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
