import { describe, expect, it } from "vitest";
import {
  formatAmount,
  minorToDecimal,
  parseAmount,
} from "../../src/domain/money";
import { DomainError } from "../../src/domain/errors";

describe("parseAmount", () => {
  it("parses whole and fractional amounts into minor units", () => {
    expect(parseAmount("1000", "USD")).toBe(100_000);
    expect(parseAmount("1000.50", "USD")).toBe(100_050);
    expect(parseAmount("0.01", "USD")).toBe(1);
    expect(parseAmount("500", "USD")).toBe(50_000);
    expect(parseAmount(400, "USD")).toBe(40_000);
  });

  it("respects per-currency minor units (AED 2, KWD 3, JPY 0)", () => {
    expect(parseAmount("10.50", "AED")).toBe(1050);
    expect(parseAmount("10.500", "KWD")).toBe(10_500);
    expect(parseAmount("10.5", "KWD")).toBe(10_500);
    expect(parseAmount("1000", "JPY")).toBe(1000);
  });

  it("rejects more decimal places than the currency supports", () => {
    expect(() => parseAmount("10.123", "USD")).toThrow(DomainError);
    expect(() => parseAmount("10.1234", "KWD")).toThrow(DomainError);
    expect(() => parseAmount("10.5", "JPY")).toThrow(DomainError);
  });

  it("rejects malformed and negative input", () => {
    for (const bad of ["", "abc", "-5", "1,000", "10.", ".5", "1e3", "Infinity", "NaN"]) {
      expect(() => parseAmount(bad, "USD"), bad).toThrow(DomainError);
    }
    expect(() => parseAmount(-5, "USD")).toThrow(DomainError);
    expect(() => parseAmount(0.1 + 0.2, "USD")).toThrow(DomainError);
  });

  it("rejects absurdly large amounts", () => {
    expect(() => parseAmount("99999999999999999", "USD")).toThrow(DomainError);
  });
});

describe("minorToDecimal", () => {
  it("renders minor units as decimal strings per currency", () => {
    expect(minorToDecimal(100_050, "USD")).toBe("1000.50");
    expect(minorToDecimal(1, "USD")).toBe("0.01");
    expect(minorToDecimal(0, "USD")).toBe("0.00");
    expect(minorToDecimal(10_500, "KWD")).toBe("10.500");
    expect(minorToDecimal(1000, "JPY")).toBe("1000");
    expect(minorToDecimal(-2500, "USD")).toBe("-25.00");
  });

  it("round-trips with parseAmount", () => {
    for (const amount of ["0.01", "1.00", "999999.99", "123456.78"]) {
      expect(minorToDecimal(parseAmount(amount, "USD"), "USD")).toBe(amount);
    }
  });
});

describe("formatAmount", () => {
  it("formats per locale and currency", () => {
    expect(formatAmount(100_000, "USD", "en-US")).toBe("$1,000.00");
    // es-ES uses narrow no-break space + trailing symbol/code.
    expect(formatAmount(100_000, "AED", "en-US")).toContain("1,000.00");
    expect(formatAmount(100_000, "AED", "es-ES")).toContain("1000,00");
  });
});
