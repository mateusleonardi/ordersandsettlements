import { DomainError } from "./errors";

/**
 * All monetary amounts are stored and computed as integers in the currency's
 * minor unit (e.g. cents for USD, fils for AED). Floating point never touches
 * arithmetic: amounts enter the system as decimal strings, are parsed digit by
 * digit, and are only converted back to decimals at the presentation edge.
 *
 * Currencies differ in their number of decimal places (the "exponent"):
 * USD/AED have 2, KWD has 3, JPY has 0. Supporting this from day one keeps the
 * money model correct even though the seed data only uses a subset.
 */
export const CURRENCIES = {
  USD: { exponent: 2 },
  AED: { exponent: 2 },
  EUR: { exponent: 2 },
  SAR: { exponent: 2 },
  KWD: { exponent: 3 },
  JPY: { exponent: 0 },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return value in CURRENCIES;
}

/** Upper bound to keep totals far away from Number.MAX_SAFE_INTEGER. */
const MAX_MINOR_UNITS = 1_000_000_000_000; // e.g. 10 billion USD in cents

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parses a positive decimal amount ("1000", "1000.50") into minor units for
 * the given currency. Rejects negative values, malformed input, more decimal
 * places than the currency supports, and amounts that are absurdly large.
 * Numbers are accepted for convenience but are stringified first so float
 * artifacts are rejected rather than silently rounded.
 */
export function parseAmount(
  input: string | number,
  currency: CurrencyCode,
): number {
  const raw = typeof input === "number" ? String(input) : input.trim();
  const match = DECIMAL_RE.exec(raw);
  if (!match) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `Invalid amount "${raw}": expected a positive decimal like "1000" or "1000.50"`,
      400,
      { amount: raw },
    );
  }
  const { exponent } = CURRENCIES[currency];
  const wholePart = match[1];
  const fractionPart = match[2] ?? "";
  if (fractionPart.length > exponent) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `Invalid amount "${raw}": ${currency} supports at most ${exponent} decimal place(s)`,
      400,
      { amount: raw, currency, maxDecimalPlaces: exponent },
    );
  }
  const minor =
    Number(wholePart) * 10 ** exponent +
    Number(fractionPart.padEnd(exponent, "0") || "0");
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR_UNITS) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `Amount "${raw}" is too large`,
      400,
      { amount: raw },
    );
  }
  return minor;
}

/** Converts minor units back to a plain decimal string ("1050" -> "10.50"). */
export function minorToDecimal(minor: number, currency: CurrencyCode): string {
  if (!Number.isSafeInteger(minor)) {
    throw new DomainError("INTERNAL", "Amount is not a safe integer", 500);
  }
  const { exponent } = CURRENCIES[currency];
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  if (exponent === 0) return `${sign}${abs}`;
  const padded = String(abs).padStart(exponent + 1, "0");
  const whole = padded.slice(0, -exponent);
  const fraction = padded.slice(-exponent);
  return `${sign}${whole}.${fraction}`;
}

/**
 * Formats minor units for display using Intl (e.g. en-US: "AED 1,000.00",
 * es-ES: "1.000,00 AED"). Presentation only; never feeds back into math.
 */
export function formatAmount(
  minor: number,
  currency: CurrencyCode,
  locale: string,
): string {
  const { exponent } = CURRENCIES[currency];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(Number(minorToDecimal(minor, currency)));
}
