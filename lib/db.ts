import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type {
  Invoice,
  InvoiceFilters,
  InvoiceLine,
  InvoiceSummaryByNumber,
  ParsedInvoice,
  WhatsappLabel,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "invoices.db");
const PDF_DIR = path.join(DATA_DIR, "pdfs");

let dbInstance: Database.Database | null = null;

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

    CREATE TABLE IF NOT EXISTS whatsapp_labels (
      whatsapp_number TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function buildInvoiceFilterClauses(filter?: InvoiceFilters) {
  const clauses: string[] = [];
  const params: string[] = [];

  const number = filter?.whatsappNumber?.trim();
  if (number) {
    clauses.push(
      `(whatsapp_number = ? OR id IN (SELECT invoice_id FROM invoice_lines WHERE whatsapp_number = ?))`,
    );
    params.push(number, number);
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
    return { invoiceId: existing.id, created: false };
  }

  const insertInvoice = db.prepare(`
    INSERT INTO invoices (
      invoice_number, issue_date, due_date, customer_name, currency,
      subtotal, total, whatsapp_number, source_email_id, email_subject, pdf_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    ? `${where} AND whatsapp_number IS NOT NULL AND whatsapp_number != ''`
    : `WHERE whatsapp_number IS NOT NULL AND whatsapp_number != ''`;

  const rows = db
    .prepare(
      `SELECT
         whatsapp_number AS whatsappNumber,
         COUNT(*) AS invoiceCount,
         SUM(total) AS totalAmount,
         currency,
         MAX(issue_date) AS latestIssueDate
       FROM invoices
       ${baseWhere}
       GROUP BY whatsapp_number, currency
       ORDER BY latestIssueDate DESC, totalAmount DESC`,
    )
    .all(...params) as Array<{
      whatsappNumber: string;
      invoiceCount: number;
      totalAmount: number;
      currency: string;
      latestIssueDate: string | null;
    }>;

  const labels = getWhatsappLabelMap();

  return rows.map((r) => ({
    whatsappNumber: r.whatsappNumber,
    displayName: labels[r.whatsappNumber] ?? null,
    invoiceCount: Number(r.invoiceCount),
    totalAmount: Number(r.totalAmount),
    currency: r.currency,
    latestIssueDate: r.latestIssueDate,
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

export function getStats(filter?: InvoiceFilters) {
  const db = getDb();
  const { where, params } = buildInvoiceFilterClauses(filter);

  const invoices = db
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS t FROM invoices ${where}`,
    )
    .get(...params) as { c: number; t: number };

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

  return {
    invoiceCount: Number(invoices.c),
    totalAmount: Number(invoices.t),
    emailCount: Number(emails.c),
    whatsappCount: Number(numbers.c),
  };
}
