"use client";

import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/client-api";

/**
 * Maps API error codes to localized messages. Validation errors surface the
 * API's specific message (field-level, English); known business-rule codes
 * are translated with their structured details interpolated.
 */
export function useApiErrorMessage(): (err: unknown) => string {
  const t = useTranslations("errors");
  return (err: unknown) => {
    if (!(err instanceof ApiError)) return t("generic");
    switch (err.code) {
      case "OVERPAYMENT":
        return t("OVERPAYMENT", {
          maxAllowed: String(err.details?.maxAllowed ?? ""),
          currency: String(err.details?.currency ?? ""),
        });
      case "REFUND_EXCEEDS_PAID":
        return t("REFUND_EXCEEDS_PAID", {
          maxRefundable: String(err.details?.maxRefundable ?? ""),
          currency: String(err.details?.currency ?? ""),
        });
      case "ORDER_NOT_EDITABLE":
      case "EMAIL_TAKEN":
      case "INVALID_CREDENTIALS":
      case "UNAUTHORIZED":
      case "NOT_FOUND":
        return t(err.code);
      case "VALIDATION_ERROR":
        return err.message;
      default:
        return t("generic");
    }
  };
}
