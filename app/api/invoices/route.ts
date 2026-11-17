import { NextRequest, NextResponse } from "next/server";
import {
  backfillCustomerEmails,
  backfillMissingWhatsappNumbers,
  getStats,
  getWhatsappLabelMap,
  listInvoiceRows,
  listWhatsappLabels,
  listWhatsappNumbers,
  summarizeByMonth,
  summarizeByWhatsapp,
  summarizeUnassigned,
} from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { parseInvoiceFilters } from "@/lib/invoice-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;

  try {
    await backfillCustomerEmails();
    await backfillMissingWhatsappNumbers();
    const filters = parseInvoiceFilters(request.nextUrl.searchParams);
    const labels = getWhatsappLabelMap();

    const numbers = listWhatsappNumbers();
    const summary = summarizeByWhatsapp(filters);
    const unassigned = summarizeUnassigned(filters);
    const monthly = summarizeByMonth(filters);
    const invoices = listInvoiceRows(filters);
    const stats = getStats(filters);

    return NextResponse.json({
      numbers,
      summary,
      unassigned,
      monthly,
      invoices,
      stats,
      labels,
      labelList: listWhatsappLabels(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao listar faturas";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
