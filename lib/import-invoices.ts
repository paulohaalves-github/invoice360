import fs from "node:fs";
import path from "node:path";
import { getPdfDir, saveInvoice } from "./db";
import { parse360DialogPdf } from "./pdf-parser";
import type { SyncResult } from "./types";

export interface InvoicePdfInput {
  name: string;
  bytes: Buffer;
}

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 100;

export function assertPdf(bytes: Buffer): void {
  if (bytes.length === 0) {
    throw new Error("arquivo vazio");
  }
  if (bytes.length > MAX_BYTES) {
    throw new Error("PDF acima de 20 MB");
  }
  if (bytes.subarray(0, 4).toString("utf8") !== "%PDF") {
    throw new Error("o arquivo não é um PDF");
  }
}

export function decodePdfBase64(name: string, dataBase64: string): Buffer {
  const cleaned = dataBase64.replace(/^data:application\/pdf;base64,/i, "").trim();
  const bytes = Buffer.from(cleaned, "base64");
  try {
    assertPdf(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF inválido";
    throw new Error(`${name}: ${message}`);
  }
  return bytes;
}

/** Grava PDFs de fatura 360dialog já baixados (Hub ou seleção local). */
export async function importInvoicePdfs(
  files: InvoicePdfInput[],
): Promise<SyncResult> {
  if (files.length > MAX_FILES) {
    throw new Error(`No máximo ${MAX_FILES} PDFs por envio.`);
  }

  const result: SyncResult = {
    processed: 0,
    imported: 0,
    skipped: 0,
    errors: [],
  };

  for (const file of files) {
    result.processed += 1;
    const label = file.name.trim() || "fatura.pdf";
    try {
      assertPdf(file.bytes);
      const parsed = await parse360DialogPdf(file.bytes);
      const safeName = parsed.invoiceNumber.replace(/[^\w.-]+/g, "_");
      const pdfPath = path.join(getPdfDir(), `${safeName}.pdf`);
      fs.writeFileSync(pdfPath, file.bytes);
      const saved = saveInvoice({
        parsed,
        sourceEmailId: null,
        emailSubject: "360dialog Hub",
        pdfPath,
      });
      if (saved.created) result.imported += 1;
      else result.skipped += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erro ao importar PDF";
      result.errors.push(`${label}: ${message}`);
    }
  }

  return result;
}
