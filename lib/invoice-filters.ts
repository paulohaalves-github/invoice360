import type { InvoiceFilters, InvoiceKind } from "./types";

const KINDS = new Set<InvoiceKind>(["usage", "prepayment", "other"]);

export function parseInvoiceFilters(
  searchParams: URLSearchParams,
): InvoiceFilters {
  const whatsappNumbers = searchParams
    .getAll("whatsapp")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  const issueDateFrom = searchParams.get("issueFrom") ?? undefined;
  const issueDateTo = searchParams.get("issueTo") ?? undefined;
  const kindRaw = (searchParams.get("kind") ?? "all").trim().toLowerCase();
  const invoiceKind =
    kindRaw === "all"
      ? "all"
      : KINDS.has(kindRaw as InvoiceKind)
        ? (kindRaw as InvoiceKind)
        : "all";
  const unassignedOnly =
    searchParams.get("unassigned") === "1" ||
    searchParams.get("unassigned") === "true";

  return {
    whatsappNumbers:
      whatsappNumbers.length > 0 ? [...new Set(whatsappNumbers)] : undefined,
    issueDateFrom: issueDateFrom || undefined,
    issueDateTo: issueDateTo || undefined,
    invoiceKind,
    unassignedOnly: unassignedOnly || undefined,
  };
}

export function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfUtcMonth(date = new Date()): string {
  return toIsoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
}

export function endOfUtcMonth(date = new Date()): string {
  return toIsoDate(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)),
  );
}

export function monthsAgoUtc(months: number, from = new Date()): string {
  return toIsoDate(
    new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - months, 1)),
  );
}

export function startOfUtcYear(date = new Date()): string {
  return toIsoDate(new Date(Date.UTC(date.getUTCFullYear(), 0, 1)));
}

export function previousPeriod(
  from: string,
  to: string,
): { from: string; to: string } {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const days =
    Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  const prevTo = new Date(fromDate);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1));
  return { from: toIsoDate(prevFrom), to: toIsoDate(prevTo) };
}
