import { describe, expect, it } from "vitest";
import { deriveStatus, isOverdue } from "../../src/domain/status";

const NOW = new Date("2026-08-10T12:00:00Z");

function status(args: {
  totalMinor?: number;
  netPaidMinor?: number;
  dueDate?: string;
  now?: Date;
}) {
  return deriveStatus({
    totalMinor: args.totalMinor ?? 100_000,
    netPaidMinor: args.netPaidMinor ?? 0,
    dueDate: args.dueDate ?? "2026-12-31",
    now: args.now ?? NOW,
  });
}

describe("deriveStatus", () => {
  it("is pending with no payments and a future due date", () => {
    expect(status({})).toBe("pending");
  });

  it("is partially_paid when 0 < netPaid < total", () => {
    expect(status({ netPaidMinor: 1 })).toBe("partially_paid");
    expect(status({ netPaidMinor: 99_999 })).toBe("partially_paid");
  });

  it("is paid when netPaid equals total", () => {
    expect(status({ netPaidMinor: 100_000 })).toBe("paid");
  });

  it("is overdue past the due date when not fully paid", () => {
    expect(status({ dueDate: "2026-08-09" })).toBe("overdue");
    expect(status({ dueDate: "2026-08-09", netPaidMinor: 50_000 })).toBe("overdue");
  });

  it("paid wins over overdue (settled late orders show as paid)", () => {
    expect(status({ dueDate: "2020-01-01", netPaidMinor: 100_000 })).toBe("paid");
  });

  it("becomes overdue only the day AFTER the due date (UTC)", () => {
    expect(status({ dueDate: "2026-08-10" })).toBe("pending");
    expect(status({ dueDate: "2026-08-10", now: new Date("2026-08-10T23:59:59Z") })).toBe("pending");
    expect(status({ dueDate: "2026-08-10", now: new Date("2026-08-11T00:00:01Z") })).toBe("overdue");
  });

  it("regresses when refunds reduce netPaid below total", () => {
    // A paid order fully refunded goes back to pending (or overdue if late).
    expect(status({ netPaidMinor: 0 })).toBe("pending");
    expect(status({ netPaidMinor: 0, dueDate: "2026-01-01" })).toBe("overdue");
    expect(status({ netPaidMinor: 40_000 })).toBe("partially_paid");
  });
});

describe("isOverdue", () => {
  it("compares calendar dates in UTC", () => {
    expect(isOverdue("2026-08-09", NOW)).toBe(true);
    expect(isOverdue("2026-08-10", NOW)).toBe(false);
    expect(isOverdue("2026-08-11", NOW)).toBe(false);
  });
});
