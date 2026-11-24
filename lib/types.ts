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
  customerEmail: string | null;
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
  customerEmail: string | null;
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

export type InvoiceKind = "usage" | "prepayment" | "other";

export interface InvoiceSummaryByNumber {
  whatsappNumber: string;
  displayName: string | null;
  customerEmail: string | null;
  invoiceCount: number;
  usageAmount: number;
  feeAmount: number;
  averageAmount: number;
  averageUsageAmount: number;
  totalAmount: number;
  usageShare: number;
  currency: string;
  latestIssueDate: string | null;
}

export interface UnassignedSummary {
  invoiceCount: number;
  usageAmount: number;
  feeAmount: number;
  totalAmount: number;
  currency: string;
}

export interface InvoiceRow {
  id: number;
  invoiceNumber: string;
  issueDate: string | null;
  dueDate: string | null;
  customerName: string | null;
  customerEmail: string | null;
  currency: string;
  total: number;
  usageAmount: number;
  feeAmount: number;
  whatsappNumber: string | null;
  whatsappNumbers: string[];
  invoiceKind: InvoiceKind;
  settledWithCredit: boolean;
  hasPdf: boolean;
}

export interface CurrencyTotal {
  currency: string;
  invoiceCount: number;
  totalAmount: number;
}

export interface MonthlySummary {
  month: string; // YYYY-MM
  invoiceCount: number;
  usageAmount: number;
  feeAmount: number;
  totalAmount: number;
  currency: string;
}

export interface WhatsappLabel {
  whatsappNumber: string;
  displayName: string;
}

export interface InvoiceFilters {
  whatsappNumbers?: string[];
  issueDateFrom?: string;
  issueDateTo?: string;
  invoiceKind?: InvoiceKind | "all";
  unassignedOnly?: boolean;
}

export interface DashboardStats {
  invoiceCount: number;
  totalAmount: number;
  emailCount: number;
  whatsappCount: number;
  usageAmount: number;
  feeAmount: number;
  feeRate: number;
  previousUsageAmount: number | null;
  usageDelta: number | null;
  usageDeltaPct: number | null;
  unassignedInvoiceCount: number;
  unassignedUsageAmount: number;
  currencyTotals: CurrencyTotal[];
}
