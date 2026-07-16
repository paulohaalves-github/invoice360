import { extractText, getDocumentProxy } from "unpdf";
import type { ParsedInvoice, ParsedInvoiceLine } from "./types";

function parseAmount(value: string): number {
  return Number.parseFloat(value.replace(",", ""));
}

function matchFirst(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[1]?.trim() ?? null;
}

function detectCurrency(text: string): string {
  const match = text.match(/\b(USD|EUR|BRL|GBP)\b/i);
  return match?.[1]?.toUpperCase() ?? "USD";
}

function extractGrossAmounts(text: string): number[] {
  // Coluna VAT "0.00 USD" seguida do Amount (Gross) "20.80 USD"
  const fromPairs = [
    ...text.matchAll(/0\.00\s+USD\s+([\d.,]+)\s+USD/gi),
  ].map((m) => parseAmount(m[1]));

  if (fromPairs.length > 0) return fromPairs;

  // Fallback: valores USD, ignorando zeros e o Total
  const all = [...text.matchAll(/([\d.,]+)\s+USD/gi)]
    .map((m) => parseAmount(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);

  return all;
}

function buildLines(
  text: string,
  phone: string | null,
  currency: string,
): ParsedInvoiceLine[] {
  const lines: ParsedInvoiceLine[] = [];
  const grossAmounts = extractGrossAmounts(text);

  const hasUsage = /whatsapp usage|prepayment for whatsapp|Phone:\s*\d+/i.test(
    text,
  );
  const hasFee = /Transaction Fee/i.test(text);

  let usageAmount: number | null = null;
  let feeAmount: number | null = null;

  if (hasUsage && hasFee && grossAmounts.length >= 2) {
    usageAmount = grossAmounts[0] ?? null;
    feeAmount = grossAmounts[1] ?? null;
  } else if (hasUsage && grossAmounts.length >= 1) {
    usageAmount = grossAmounts[0] ?? null;
  } else if (hasFee && grossAmounts.length >= 1) {
    feeAmount = grossAmounts[0] ?? null;
  }

  if (usageAmount != null) {
    const unit =
      matchFirst(
        text,
        /Phone:\s*\d+[\s\S]{0,120}?([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i,
      ) != null
        ? parseAmount(
            text.match(
              /Phone:\s*\d+[\s\S]{0,120}?[\d.,]+\s+([\d.,]+)/i,
            )?.[1] ?? String(usageAmount),
          )
        : usageAmount;

    lines.push({
      whatsappNumber: phone,
      description:
        "WhatsApp Business Account — prepayment for WhatsApp usage costs",
      lineType: "usage",
      quantity: 1,
      unitPrice: unit,
      amount: usageAmount,
    });
  }

  if (feeAmount != null) {
    lines.push({
      whatsappNumber: phone,
      description: "Transaction Fee",
      lineType: "fee",
      quantity: 1,
      unitPrice: feeAmount,
      amount: feeAmount,
    });
  }

  if (lines.length === 0 && grossAmounts.length > 0) {
    for (const amount of grossAmounts) {
      lines.push({
        whatsappNumber: phone,
        description: `Line item (${currency})`,
        lineType: "other",
        quantity: 1,
        unitPrice: amount,
        amount,
      });
    }
  }

  return lines;
}

export function parse360DialogInvoiceText(text: string): ParsedInvoice {
  const normalized = text.replace(/\r\n/g, "\n");

  const invoiceNumber = matchFirst(
    normalized,
    /Invoice number:\s*(INV[\w-]+)/i,
  );
  if (!invoiceNumber) {
    throw new Error(
      "Não foi possível identificar o número da fatura (Invoice number).",
    );
  }

  const issueDate = matchFirst(
    normalized,
    /Date of issue:\s*(\d{4}-\d{2}-\d{2})/i,
  );
  const dueDate = matchFirst(normalized, /Date due:\s*(\d{4}-\d{2}-\d{2})/i);

  const customerName =
    matchFirst(normalized, /Bill to\s*\n+\s*([^\n]+)/i) ??
    matchFirst(normalized, /Bill to\s+([^\n]+)/i);

  const phone = matchFirst(normalized, /Phone:\s*(\d{10,15})/i);
  const currency = detectCurrency(normalized);

  const subtotalRaw = matchFirst(
    normalized,
    /Subtotal\s+([\d.,]+)\s*(?:USD|EUR|BRL|GBP)?/i,
  );
  const totalRaw =
    matchFirst(
      normalized,
      /(?:^|\n)\s*Total\s+([\d.,]+)\s*(?:USD|EUR|BRL|GBP)/im,
    ) ??
    matchFirst(normalized, /Total\s+([\d.,]+)\s*(?:USD|EUR|BRL|GBP)/i);

  const subtotal = subtotalRaw ? parseAmount(subtotalRaw) : null;
  let total = totalRaw ? parseAmount(totalRaw) : null;

  const lines = buildLines(normalized, phone, currency);

  if (total == null) {
    const sum = lines.reduce((acc, line) => acc + line.amount, 0);
    total = subtotal ?? sum;
  }

  if (!Number.isFinite(total)) {
    throw new Error(`Total inválido na fatura ${invoiceNumber}.`);
  }

  return {
    invoiceNumber,
    issueDate,
    dueDate,
    customerName,
    currency,
    subtotal,
    total,
    whatsappNumber: phone,
    lines,
    rawText: normalized,
  };
}

export async function parse360DialogPdf(
  pdfBytes: Uint8Array | Buffer,
): Promise<ParsedInvoice> {
  const data =
    pdfBytes instanceof Buffer
      ? new Uint8Array(pdfBytes)
      : pdfBytes;

  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  const content = Array.isArray(text) ? text.join("\n") : String(text ?? "");

  if (!content.trim()) {
    throw new Error("O PDF não contém texto extraível.");
  }

  return parse360DialogInvoiceText(content);
}
