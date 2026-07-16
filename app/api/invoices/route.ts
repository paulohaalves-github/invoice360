import { NextRequest, NextResponse } from "next/server";
import {
  getStats,
  getWhatsappLabelMap,
  listInvoices,
  listWhatsappLabels,
  listWhatsappNumbers,
  summarizeByWhatsapp,
} from "@/lib/db";
import type { InvoiceFilters } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseFilters(request: NextRequest): InvoiceFilters {
  const whatsappNumber =
    request.nextUrl.searchParams.get("whatsapp") ?? undefined;
  const issueDateFrom =
    request.nextUrl.searchParams.get("issueFrom") ?? undefined;
  const issueDateTo =
    request.nextUrl.searchParams.get("issueTo") ?? undefined;

  return {
    whatsappNumber: whatsappNumber || undefined,
    issueDateFrom: issueDateFrom || undefined,
    issueDateTo: issueDateTo || undefined,
  };
}

export async function GET(request: NextRequest) {
  try {
    const filters = parseFilters(request);
    const labels = getWhatsappLabelMap();

    const invoices = listInvoices(filters);
    const numbers = listWhatsappNumbers();
    const summary = summarizeByWhatsapp(filters);
    const stats = getStats(filters);

    return NextResponse.json({
      invoices,
      numbers,
      summary,
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
