export type InvoiceLineType = "usage" | "fee" | "other";

export interface InvoiceLine {
  id: number;
  invoiceId: number;
  whatsappNumber: string | null;
  description: string;
  lineType: InvoiceLineType;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
}

export interface Invoice {
  id: number;
  invoiceNumber: string;
  issueDate: string | null;
  dueDate: string | null;
  customerName: string | null;
  currency: string;
  subtotal: number | null;
  total: number;
  whatsappNumber: string | null;
  sourceEmailId: number | null;
  emailSubject: string | null;
  pdfPath: string | null;
  createdAt: string;
  lines: InvoiceLine[];
}

export interface ParsedInvoiceLine {
  whatsappNumber: string | null;
  description: string;
  lineType: InvoiceLineType;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
}

export interface ParsedInvoice {
  invoiceNumber: string;
  issueDate: string | null;
  dueDate: string | null;
  customerName: string | null;
  currency: string;
  subtotal: number | null;
  total: number;
  whatsappNumber: string | null;
  lines: ParsedInvoiceLine[];
  rawText: string;
}

export interface SyncResult {
  processed: number;
  imported: number;
  skipped: number;
  errors: string[];
}

export interface InvoiceSummaryByNumber {
  whatsappNumber: string;
  displayName: string | null;
  invoiceCount: number;
  totalAmount: number;
  currency: string;
  latestIssueDate: string | null;
}

export interface MonthlySummary {
  month: string; // YYYY-MM
  invoiceCount: number;
  totalAmount: number;
  currency: string;
}

export interface WhatsappLabel {
  whatsappNumber: string;
  displayName: string;
}

export interface InvoiceFilters {
  whatsappNumber?: string;
  issueDateFrom?: string;
  issueDateTo?: string;
}
