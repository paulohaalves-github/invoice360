import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { parse360DialogPdf } from "./pdf-parser";
import { previousPeriod } from "./invoice-filters";
import type {
  CurrencyTotal,
  DashboardStats,
  Invoice,
  InvoiceFilters,
  InvoiceKind,
  InvoiceLine,
  InvoiceRow,
  InvoiceSummaryByNumber,
  MonthlySummary,
  ParsedInvoice,
  UnassignedSummary,
  WhatsappLabel,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "invoices.db");
const PDF_DIR = path.join(DATA_DIR, "pdfs");

let dbInstance: Database.Database | null = null;

function cleanEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "-") return null;
  return trimmed;
}

const LINE_AMOUNTS_JOIN = `
  LEFT JOIN (
    SELECT
      invoice_id,
      SUM(CASE WHEN line_type = 'usage' THEN amount ELSE 0 END) AS usage_amount,
      SUM(CASE WHEN line_type = 'fee' THEN amount ELSE 0 END) AS fee_amount,
      MAX(CASE WHEN lower(description) LIKE '%prepayment%' THEN 1 ELSE 0 END) AS is_prepayment,
      MAX(
        CASE
          WHEN lower(description) LIKE '%usage costs%'
            OR lower(description) LIKE '%whatsapp usage%'
          THEN 1
          ELSE 0
        END
      ) AS is_usage_costs
    FROM invoice_lines
    GROUP BY invoice_id
  ) AS lines ON lines.invoice_id = invoices.id
`;

function classifyInvoiceKind(row: {
  is_prepayment?: number | null;
  isPrepayment?: number | null;
  is_usage_costs?: number | null;
  isUsageCosts?: number | null;
}): InvoiceKind {
  const prepayment = Number(row.is_prepayment ?? row.isPrepayment ?? 0) > 0;
  const usageCosts = Number(row.is_usage_costs ?? row.isUsageCosts ?? 0) > 0;
  if (prepayment) return "prepayment";
  if (usageCosts) return "usage";
  return "other";
}

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PDF_DIR, { recursive: true });
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL UNIQUE,
      subject TEXT,
      from_address TEXT,
      received_at TEXT,
      status TEXT NOT NULL DEFAULT 'processed',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL UNIQUE,
      issue_date TEXT,
      due_date TEXT,
      customer_name TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      subtotal REAL,
      total REAL NOT NULL,
      whatsapp_number TEXT,
      source_email_id INTEGER,
      email_subject TEXT,
      pdf_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (source_email_id) REFERENCES emails(id)
    );

    CREATE TABLE IF NOT EXISTS invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      whatsapp_number TEXT,
      description TEXT NOT NULL,
      line_type TEXT NOT NULL DEFAULT 'other',
      quantity REAL,
      unit_price REAL,
      amount REAL NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_whatsapp ON invoices(whatsapp_number);
    CREATE INDEX IF NOT EXISTS idx_lines_whatsapp ON invoice_lines(whatsapp_number);
    CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
    CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);

    CREATE TABLE IF NOT EXISTS whatsapp_labels (
      whatsapp_number TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const columns = db.prepare("PRAGMA table_info(invoices)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "customer_email")) {
    db.exec("ALTER TABLE invoices ADD COLUMN customer_email TEXT");
  }
}

function buildInvoiceFilterClauses(filter?: InvoiceFilters) {
  const clauses: string[] = [];
  const params: string[] = [];

  if (filter?.unassignedOnly) {
    clauses.push(`(whatsapp_number IS NULL OR whatsapp_number = '')`);
  } else {
    const numbers = (filter?.whatsappNumbers ?? [])
      .map((n) => n.trim())
      .filter(Boolean);

    if (numbers.length === 1) {
      clauses.push(
        `(whatsapp_number = ? OR id IN (SELECT invoice_id FROM invoice_lines WHERE whatsapp_number = ?))`,
      );
      params.push(numbers[0], numbers[0]);
    } else if (numbers.length > 1) {
      const placeholders = numbers.map(() => "?").join(", ");
      clauses.push(
        `(whatsapp_number IN (${placeholders}) OR id IN (
           SELECT invoice_id FROM invoice_lines WHERE whatsapp_number IN (${placeholders})
         ))`,
      );
      params.push(...numbers, ...numbers);
    }
  }

  const issueFrom = filter?.issueDateFrom?.trim();
  if (issueFrom) {
    clauses.push(`issue_date >= ?`);
    params.push(issueFrom);
  }

  const issueTo = filter?.issueDateTo?.trim();
  if (issueTo) {
    clauses.push(`issue_date <= ?`);
    params.push(issueTo);
  }

  const kind = filter?.invoiceKind;
  if (kind === "prepayment") {
    clauses.push(
      `id IN (
         SELECT invoice_id FROM invoice_lines
         WHERE lower(description) LIKE '%prepayment%'
       )`,
    );
  } else if (kind === "usage") {
    clauses.push(
      `id IN (
         SELECT invoice_id FROM invoice_lines
         WHERE lower(description) LIKE '%usage costs%'
            OR lower(description) LIKE '%whatsapp usage%'
       )
       AND id NOT IN (
         SELECT invoice_id FROM invoice_lines
         WHERE lower(description) LIKE '%prepayment%'
       )`,
    );
  } else if (kind === "other") {
    clauses.push(
      `id NOT IN (
         SELECT invoice_id FROM invoice_lines
         WHERE lower(description) LIKE '%prepayment%'
            OR lower(description) LIKE '%usage costs%'
            OR lower(description) LIKE '%whatsapp usage%'
       )`,
    );
  }

  const where =
    clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  return { where, params };
}

export function getDb() {
  if (dbInstance) return dbInstance;
  ensureDirs();
  dbInstance = new Database(DB_PATH);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("foreign_keys = ON");
  migrate(dbInstance);
  return dbInstance;
}

export function getPdfDir() {
  ensureDirs();
  return PDF_DIR;
}

export function emailExists(messageId: string): boolean {
  const row = getDb()
    .prepare("SELECT id FROM emails WHERE message_id = ?")
    .get(messageId);
  return Boolean(row);
}

export function insertEmail(input: {
  messageId: string;
  subject: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO emails (message_id, subject, from_address, received_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      input.messageId,
      input.subject,
      input.fromAddress,
      input.receivedAt,
    );
  return Number(result.lastInsertRowid);
}

export function saveInvoice(input: {
  parsed: ParsedInvoice;
  sourceEmailId: number | null;
  emailSubject: string | null;
  pdfPath: string | null;
}): { invoiceId: number; created: boolean } {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM invoices WHERE invoice_number = ?")
    .get(input.parsed.invoiceNumber) as { id: number } | undefined;

  if (existing) {
    if (input.parsed.customerEmail) {
      db.prepare(
        `UPDATE invoices
         SET customer_email = ?
         WHERE id = ? AND (customer_email IS NULL OR customer_email = '')`,
      ).run(input.parsed.customerEmail, existing.id);
    }
    if (input.parsed.whatsappNumber) {
      db.prepare(
        `UPDATE invoices
         SET whatsapp_number = ?
         WHERE id = ? AND (whatsapp_number IS NULL OR whatsapp_number = '')`,
      ).run(input.parsed.whatsappNumber, existing.id);
      db.prepare(
        `UPDATE invoice_lines
         SET whatsapp_number = ?
         WHERE invoice_id = ? AND (whatsapp_number IS NULL OR whatsapp_number = '')`,
      ).run(input.parsed.whatsappNumber, existing.id);
    }
    return { invoiceId: existing.id, created: false };
  }

  const insertInvoice = db.prepare(`
    INSERT INTO invoices (
      invoice_number, issue_date, due_date, customer_name, customer_email, currency,
      subtotal, total, whatsapp_number, source_email_id, email_subject, pdf_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLine = db.prepare(`
    INSERT INTO invoice_lines (
      invoice_id, whatsapp_number, description, line_type, quantity, unit_price, amount
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    const result = insertInvoice.run(
      input.parsed.invoiceNumber,
      input.parsed.issueDate,
      input.parsed.dueDate,
      input.parsed.customerName,
      input.parsed.customerEmail,
      input.parsed.currency,
      input.parsed.subtotal,
      input.parsed.total,
      input.parsed.whatsappNumber,
      input.sourceEmailId,
      input.emailSubject,
      input.pdfPath,
    );
    const invoiceId = Number(result.lastInsertRowid);

    for (const line of input.parsed.lines) {
      insertLine.run(
        invoiceId,
        line.whatsappNumber,
        line.description,
        line.lineType,
        line.quantity,
        line.unitPrice,
        line.amount,
      );
    }

    return invoiceId;
  });

  return { invoiceId: tx(), created: true };
}

function mapLine(row: Record<string, unknown>): InvoiceLine {
  return {
    id: Number(row.id),
    invoiceId: Number(row.invoice_id),
    whatsappNumber: (row.whatsapp_number as string | null) ?? null,
    description: String(row.description),
    lineType: row.line_type as InvoiceLine["lineType"],
    quantity: row.quantity == null ? null : Number(row.quantity),
    unitPrice: row.unit_price == null ? null : Number(row.unit_price),
    amount: Number(row.amount),
  };
}

function mapInvoice(
  row: Record<string, unknown>,
  lines: InvoiceLine[],
): Invoice {
  return {
    id: Number(row.id),
    invoiceNumber: String(row.invoice_number),
    issueDate: (row.issue_date as string | null) ?? null,
    dueDate: (row.due_date as string | null) ?? null,
    customerName: (row.customer_name as string | null) ?? null,
    customerEmail: cleanEmail(row.customer_email as string | null),
    currency: String(row.currency),
    subtotal: row.subtotal == null ? null : Number(row.subtotal),
    total: Number(row.total),
    whatsappNumber: (row.whatsapp_number as string | null) ?? null,
    sourceEmailId:
      row.source_email_id == null ? null : Number(row.source_email_id),
    emailSubject: (row.email_subject as string | null) ?? null,
    pdfPath: (row.pdf_path as string | null) ?? null,
    createdAt: String(row.created_at),
    lines,
  };
}

export function listInvoices(filter?: InvoiceFilters): Invoice[] {
  const db = getDb();
  const { where, params } = buildInvoiceFilterClauses(filter);

  const invoiceRows = db
    .prepare(
      `SELECT * FROM invoices ${where} ORDER BY issue_date DESC, id DESC`,
    )
    .all(...params) as Record<string, unknown>[];

  const lineStmt = db.prepare(
    `SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id ASC`,
  );

  return invoiceRows.map((row) => {
    const lines = (lineStmt.all(row.id) as Record<string, unknown>[]).map(
      mapLine,
    );
    return mapInvoice(row, lines);
  });
}

export function listWhatsappNumbers(): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT whatsapp_number AS n FROM invoices
       WHERE whatsapp_number IS NOT NULL AND whatsapp_number != ''
       UNION
       SELECT DISTINCT whatsapp_number AS n FROM invoice_lines
       WHERE whatsapp_number IS NOT NULL AND whatsapp_number != ''
       ORDER BY n`,
    )
    .all() as { n: string }[];
  return rows.map((r) => r.n);
}

export function summarizeByWhatsapp(
  filter?: InvoiceFilters,
): InvoiceSummaryByNumber[] {
  const db = getDb();
  const { where, params } = buildInvoiceFilterClauses(filter);
  const baseWhere = where
    ? `${where} AND invoices.whatsapp_number IS NOT NULL AND invoices.whatsapp_number != ''`
    : `WHERE invoices.whatsapp_number IS NOT NULL AND invoices.whatsapp_number != ''`;

  const rows = db
    .prepare(
      `SELECT
         invoices.whatsapp_number AS whatsappNumber,
         COUNT(*) AS invoiceCount,
         SUM(invoices.total) AS totalAmount,
         invoices.currency AS currency,
         MAX(invoices.issue_date) AS latestIssueDate,
         COALESCE(SUM(lines.usage_amount), 0) AS usageAmount,
         COALESCE(SUM(lines.fee_amount), 0) AS feeAmount,
         (
           SELECT recent.customer_email
           FROM invoices AS recent
           WHERE recent.whatsapp_number = invoices.whatsapp_number
             AND recent.customer_email IS NOT NULL
             AND recent.customer_email != ''
           ORDER BY recent.issue_date DESC, recent.id DESC
           LIMIT 1
         ) AS customerEmail
       FROM invoices
       ${LINE_AMOUNTS_JOIN}
       ${baseWhere}
       GROUP BY invoices.whatsapp_number, invoices.currency
       ORDER BY latestIssueDate DESC, totalAmount DESC`,
    )
    .all(...params) as Array<{
      whatsappNumber: string;
      invoiceCount: number;
      totalAmount: number;
      currency: string;
      latestIssueDate: string | null;
      usageAmount: number;
      feeAmount: number;
      customerEmail: string | null;
    }>;

  const labels = getWhatsappLabelMap();

  const mapped = rows.map((r) => {
    const invoiceCount = Number(r.invoiceCount);
    const totalAmount = Number(r.totalAmount);
    const usageAmount = Number(r.usageAmount);
    return {
      whatsappNumber: r.whatsappNumber,
      displayName: labels[r.whatsappNumber] ?? null,
      customerEmail: cleanEmail(r.customerEmail),
      invoiceCount,
      usageAmount,
      feeAmount: Number(r.feeAmount),
      averageAmount: invoiceCount > 0 ? totalAmount / invoiceCount : 0,
      averageUsageAmount: invoiceCount > 0 ? usageAmount / invoiceCount : 0,
      totalAmount,
      usageShare: 0,
      currency: r.currency,
      latestIssueDate: r.latestIssueDate,
    };
  });

  const usageTotal = mapped.reduce((sum, row) => sum + row.usageAmount, 0);
  return mapped
    .map((row) => ({
      ...row,
      usageShare: usageTotal > 0 ? row.usageAmount / usageTotal : 0,
    }))
    .sort(
      (a, b) =>
        b.usageAmount - a.usageAmount ||
        b.totalAmount - a.totalAmount ||
        (b.latestIssueDate ?? "").localeCompare(a.latestIssueDate ?? ""),
    );
}

export function summarizeUnassigned(
  filter?: InvoiceFilters,
): UnassignedSummary | null {
  if (filter?.unassignedOnly) return null;
  const db = getDb();
  const { where, params } = buildInvoiceFilterClauses({
    ...filter,
    whatsappNumbers: undefined,
    unassignedOnly: true,
  });
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS invoiceCount,
         COALESCE(SUM(invoices.total), 0) AS totalAmount,
         COALESCE(SUM(lines.usage_amount), 0) AS usageAmount,
         COALESCE(SUM(lines.fee_amount), 0) AS feeAmount,
         COALESCE(MAX(invoices.currency), 'USD') AS currency
       FROM invoices
       ${LINE_AMOUNTS_JOIN}
       ${where}`,
    )
    .get(...params) as {
      invoiceCount: number;
      totalAmount: number;
      usageAmount: number;
      feeAmount: number;
      currency: string;
    };

  const invoiceCount = Number(row.invoiceCount);
  if (invoiceCount === 0) return null;
  return {
    invoiceCount,
    usageAmount: Number(row.usageAmount),
    feeAmount: Number(row.feeAmount),
    totalAmount: Number(row.totalAmount),
    currency: row.currency || "USD",
  };
}

export function listInvoiceRows(filter?: InvoiceFilters): InvoiceRow[] {
  const db = getDb();
  const { where, params } = buildInvoiceFilterClauses(filter);
  const rows = db
    .prepare(
      `SELECT
         invoices.id AS id,
         invoices.invoice_number AS invoiceNumber,
         invoices.issue_date AS issueDate,
         invoices.due_date AS dueDate,
         invoices.customer_name AS customerName,
         invoices.customer_email AS customerEmail,
         invoices.currency AS currency,
         invoices.total AS total,
         invoices.whatsapp_number AS whatsappNumber,
         invoices.pdf_path AS pdfPath,
         COALESCE(lines.usage_amount, 0) AS usageAmount,
         COALESCE(lines.fee_amount, 0) AS feeAmount,
         COALESCE(lines.is_prepayment, 0) AS isPrepayment,
         COALESCE(lines.is_usage_costs, 0) AS isUsageCosts
       FROM invoices
       ${LINE_AMOUNTS_JOIN}
       ${where}
       ORDER BY invoices.issue_date DESC, invoices.id DESC`,
    )
    .all(...params) as Array<{
      id: number;
      invoiceNumber: string;
      issueDate: string | null;
      dueDate: string | null;
      customerName: string | null;
      customerEmail: string | null;
      currency: string;
      total: number;
      whatsappNumber: string | null;
      pdfPath: string | null;
      usageAmount: number;
      feeAmount: number;
      isPrepayment: number;
      isUsageCosts: number;
    }>;

  return rows.map((row) => {
    const usageAmount = Number(row.usageAmount);
    const total = Number(row.total);
    return {
      id: Number(row.id),
      invoiceNumber: row.invoiceNumber,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      customerName: row.customerName,
      customerEmail: cleanEmail(row.customerEmail),
      currency: row.currency,
      total,
      usageAmount,
      feeAmount: Number(row.feeAmount),
      whatsappNumber: row.whatsappNumber,
      invoiceKind: classifyInvoiceKind(row),
      settledWithCredit: usageAmount > 0 && Math.abs(total) < 0.005,
      hasPdf: Boolean(row.pdfPath),
    };
  });
}

export function getInvoicePdf(id: number): {
  invoiceNumber: string;
  pdfPath: string;
} | null {
  const row = getDb()
    .prepare(
      `SELECT invoice_number AS invoiceNumber, pdf_path AS pdfPath
       FROM invoices WHERE id = ?`,
    )
    .get(id) as { invoiceNumber: string; pdfPath: string | null } | undefined;
  if (!row?.pdfPath) return null;
  const pdfDir = path.resolve(getPdfDir());
  const filePath = path.resolve(row.pdfPath);
  if (!filePath.startsWith(pdfDir + path.sep) && filePath !== pdfDir) {
    return null;
  }
  if (!fs.existsSync(filePath)) return null;
  return { invoiceNumber: row.invoiceNumber, pdfPath: filePath };
}

export async function backfillCustomerEmails(): Promise<void> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, pdf_path AS pdfPath
       FROM invoices
       WHERE (customer_email IS NULL OR customer_email = '')
         AND pdf_path IS NOT NULL AND pdf_path != ''`,
    )
    .all() as Array<{ id: number; pdfPath: string }>;

  const update = db.prepare(
    `UPDATE invoices SET customer_email = ? WHERE id = ?`,
  );

  for (const row of rows) {
    let email = "";
    try {
      if (fs.existsSync(row.pdfPath)) {
        const bytes = fs.readFileSync(row.pdfPath);
        const parsed = await parse360DialogPdf(bytes);
        email = parsed.customerEmail ?? "-";
      }
    } catch {
      email = "-";
    }
    update.run(email || "-", row.id);
  }
}

let whatsappBackfillDone = false;

export async function backfillMissingWhatsappNumbers(): Promise<void> {
  if (whatsappBackfillDone) return;
  whatsappBackfillDone = true;

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, pdf_path AS pdfPath
       FROM invoices
       WHERE (whatsapp_number IS NULL OR whatsapp_number = '')
         AND pdf_path IS NOT NULL AND pdf_path != ''`,
    )
    .all() as Array<{ id: number; pdfPath: string }>;

  const updateInvoice = db.prepare(
    `UPDATE invoices SET whatsapp_number = ?
     WHERE id = ? AND (whatsapp_number IS NULL OR whatsapp_number = '')`,
  );
  const updateLines = db.prepare(
    `UPDATE invoice_lines SET whatsapp_number = ?
     WHERE invoice_id = ? AND (whatsapp_number IS NULL OR whatsapp_number = '')`,
  );

  for (const row of rows) {
    if (!fs.existsSync(row.pdfPath)) continue;
    try {
      const parsed = await parse360DialogPdf(fs.readFileSync(row.pdfPath));
      if (!parsed.whatsappNumber) continue;
      updateInvoice.run(parsed.whatsappNumber, row.id);
      updateLines.run(parsed.whatsappNumber, row.id);
    } catch {
      // A próxima inicialização do servidor tenta de novo.
      whatsappBackfillDone = false;
    }
  }
}

export function summarizeByMonth(filter?: InvoiceFilters): MonthlySummary[] {
  const db = getDb();
  const { where, params } = buildInvoiceFilterClauses(filter);
  const baseWhere = where
    ? `${where} AND invoices.issue_date IS NOT NULL AND invoices.issue_date != ''`
    : `WHERE invoices.issue_date IS NOT NULL AND invoices.issue_date != ''`;

  const rows = db
    .prepare(
      `SELECT
         substr(invoices.issue_date, 1, 7) AS month,
         COUNT(*) AS invoiceCount,
         SUM(invoices.total) AS totalAmount,
         COALESCE(SUM(lines.usage_amount), 0) AS usageAmount,
         COALESCE(SUM(lines.fee_amount), 0) AS feeAmount,
         invoices.currency AS currency
       FROM invoices
       ${LINE_AMOUNTS_JOIN}
       ${baseWhere}
       GROUP BY month, invoices.currency
       ORDER BY month ASC`,
    )
    .all(...params) as Array<{
      month: string;
      invoiceCount: number;
      totalAmount: number;
      usageAmount: number;
      feeAmount: number;
      currency: string;
    }>;

  return rows.map((r) => ({
    month: r.month,
    invoiceCount: Number(r.invoiceCount),
    usageAmount: Number(r.usageAmount),
    feeAmount: Number(r.feeAmount),
    totalAmount: Number(r.totalAmount),
    currency: r.currency,
  }));
}

export function listWhatsappLabels(): WhatsappLabel[] {
  const rows = getDb()
    .prepare(
      `SELECT whatsapp_number AS whatsappNumber, display_name AS displayName
       FROM whatsapp_labels
       ORDER BY display_name COLLATE NOCASE ASC`,
    )
    .all() as WhatsappLabel[];
  return rows;
}

export function getWhatsappLabelMap(): Record<string, string> {
  const rows = listWhatsappLabels();
  return Object.fromEntries(
    rows.map((row) => [row.whatsappNumber, row.displayName]),
  );
}

export function setWhatsappLabel(
  whatsappNumber: string,
  displayName: string,
): WhatsappLabel {
  const number = whatsappNumber.trim();
  const name = displayName.trim();
  if (!number) {
    throw new Error("Número WhatsApp é obrigatório.");
  }
  if (!name) {
    throw new Error("Nome é obrigatório.");
  }

  getDb()
    .prepare(
      `INSERT INTO whatsapp_labels (whatsapp_number, display_name, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(whatsapp_number) DO UPDATE SET
         display_name = excluded.display_name,
         updated_at = datetime('now')`,
    )
    .run(number, name);

  return { whatsappNumber: number, displayName: name };
}

export function deleteWhatsappLabel(whatsappNumber: string): void {
  getDb()
    .prepare(`DELETE FROM whatsapp_labels WHERE whatsapp_number = ?`)
    .run(whatsappNumber.trim());
}

function readUsageAmount(filter?: InvoiceFilters): number {
  const db = getDb();
  const { where, params } = buildInvoiceFilterClauses(filter);
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN line_type = 'usage' THEN amount ELSE 0 END), 0) AS usageAmount
       FROM invoice_lines
       WHERE invoice_id IN (SELECT id FROM invoices ${where})`,
    )
    .get(...params) as { usageAmount: number };
  return Number(row.usageAmount);
}

export function getStats(filter?: InvoiceFilters): DashboardStats {
  const db = getDb();
  const { where, params } = buildInvoiceFilterClauses(filter);

  const invoices = db
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS t FROM invoices ${where}`,
    )
    .get(...params) as { c: number; t: number };

  const currencyRows = db
    .prepare(
      `SELECT currency, COUNT(*) AS invoiceCount, COALESCE(SUM(total), 0) AS totalAmount
       FROM invoices ${where}
       GROUP BY currency
       ORDER BY totalAmount DESC`,
    )
    .all(...params) as CurrencyTotal[];

  const lineTotals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN line_type = 'usage' THEN amount ELSE 0 END), 0) AS usageAmount,
         COALESCE(SUM(CASE WHEN line_type = 'fee' THEN amount ELSE 0 END), 0) AS feeAmount
       FROM invoice_lines
       WHERE invoice_id IN (SELECT id FROM invoices ${where})`,
    )
    .get(...params) as { usageAmount: number; feeAmount: number };

  const numbersWhere = where
    ? `${where} AND whatsapp_number IS NOT NULL AND whatsapp_number != ''`
    : `WHERE whatsapp_number IS NOT NULL AND whatsapp_number != ''`;
  const numbers = db
    .prepare(
      `SELECT COUNT(DISTINCT whatsapp_number) AS c FROM invoices ${numbersWhere}`,
    )
    .get(...params) as { c: number };

  const emails = db
    .prepare(`SELECT COUNT(*) AS c FROM emails`)
    .get() as { c: number };

  const unassigned = summarizeUnassigned(filter);

  const usageAmount = Number(lineTotals.usageAmount);
  const feeAmount = Number(lineTotals.feeAmount);

  let previousUsageAmount: number | null = null;
  let usageDelta: number | null = null;
  let usageDeltaPct: number | null = null;

  const from = filter?.issueDateFrom?.trim();
  const to = filter?.issueDateTo?.trim();
  if (from && to) {
    const previous = previousPeriod(from, to);
    previousUsageAmount = readUsageAmount({
      ...filter,
      issueDateFrom: previous.from,
      issueDateTo: previous.to,
    });
    usageDelta = usageAmount - previousUsageAmount;
    usageDeltaPct =
      previousUsageAmount > 0
        ? usageDelta / previousUsageAmount
        : previousUsageAmount === 0 && usageAmount === 0
          ? 0
          : null;
  }

  return {
    invoiceCount: Number(invoices.c),
    totalAmount: Number(invoices.t),
    emailCount: Number(emails.c),
    whatsappCount: Number(numbers.c),
    usageAmount,
    feeAmount,
    feeRate: usageAmount > 0 ? feeAmount / usageAmount : 0,
    previousUsageAmount,
    usageDelta,
    usageDeltaPct,
    unassignedInvoiceCount: unassigned?.invoiceCount ?? 0,
    unassignedUsageAmount: unassigned?.usageAmount ?? 0,
    currencyTotals: currencyRows.map((row) => ({
      currency: row.currency,
      invoiceCount: Number(row.invoiceCount),
      totalAmount: Number(row.totalAmount),
    })),
  };
}
