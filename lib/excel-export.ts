import ExcelJS from "exceljs";
import type { InvoiceRow, InvoiceSummaryByNumber } from "./types";

function dateCell(value: string | null): string {
  return value ?? "";
}

export async function buildInvoicesWorkbook(input: {
  summary: InvoiceSummaryByNumber[];
  invoices: InvoiceRow[];
  labels: Record<string, string>;
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Invoice360";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet("Resumo");
  summarySheet.columns = [
    { header: "Apelido", key: "displayName", width: 22 },
    { header: "WhatsApp", key: "whatsappNumber", width: 18 },
    { header: "E-mail", key: "customerEmail", width: 32 },
    { header: "Última emissão", key: "latestIssueDate", width: 16 },
    { header: "Faturas", key: "invoiceCount", width: 12 },
    { header: "Uso", key: "usageAmount", width: 14 },
    { header: "Taxa", key: "feeAmount", width: 14 },
    { header: "% Uso", key: "usageShare", width: 10 },
    { header: "Média uso", key: "averageUsageAmount", width: 14 },
    { header: "Caixa", key: "totalAmount", width: 14 },
    { header: "Moeda", key: "currency", width: 10 },
  ];
  for (const row of input.summary) {
    summarySheet.addRow({
      displayName: row.displayName ?? "",
      whatsappNumber: row.whatsappNumber,
      customerEmail: row.customerEmail ?? "",
      latestIssueDate: dateCell(row.latestIssueDate),
      invoiceCount: row.invoiceCount,
      usageAmount: row.usageAmount,
      feeAmount: row.feeAmount,
      usageShare: row.usageShare,
      averageUsageAmount: row.averageUsageAmount,
      totalAmount: row.totalAmount,
      currency: row.currency,
    });
  }
  formatMoneyColumns(summarySheet, [
    "usageAmount",
    "feeAmount",
    "averageUsageAmount",
    "totalAmount",
  ]);

  const invoiceSheet = workbook.addWorksheet("Faturas");
  invoiceSheet.columns = [
    { header: "Fatura", key: "invoiceNumber", width: 18 },
    { header: "Emissão", key: "issueDate", width: 14 },
    { header: "Vencimento", key: "dueDate", width: 14 },
    { header: "Tipo", key: "invoiceKind", width: 14 },
    { header: "Apelido", key: "displayName", width: 22 },
    { header: "WhatsApp", key: "whatsappNumber", width: 18 },
    { header: "E-mail", key: "customerEmail", width: 32 },
    { header: "Uso", key: "usageAmount", width: 14 },
    { header: "Taxa", key: "feeAmount", width: 14 },
    { header: "Caixa", key: "total", width: 14 },
    { header: "Crédito", key: "settledWithCredit", width: 10 },
    { header: "Moeda", key: "currency", width: 10 },
  ];
  for (const row of input.invoices) {
    invoiceSheet.addRow({
      invoiceNumber: row.invoiceNumber,
      issueDate: dateCell(row.issueDate),
      dueDate: dateCell(row.dueDate),
      invoiceKind: row.invoiceKind,
      displayName: row.whatsappNumber
        ? (input.labels[row.whatsappNumber] ?? "")
        : "",
      whatsappNumber: row.whatsappNumber ?? "",
      customerEmail: row.customerEmail ?? "",
      usageAmount: row.usageAmount,
      feeAmount: row.feeAmount,
      total: row.total,
      settledWithCredit: row.settledWithCredit ? "sim" : "",
      currency: row.currency,
    });
  }
  formatMoneyColumns(invoiceSheet, ["usageAmount", "feeAmount", "total"]);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function formatMoneyColumns(sheet: ExcelJS.Worksheet, keys: string[]) {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  };
  for (const key of keys) {
    const column = sheet.getColumn(key);
    column.numFmt = "#,##0.00";
  }
}
