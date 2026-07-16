import { NextRequest, NextResponse } from "next/server";
import {
  getStats,
  getWhatsappLabelMap,
  listWhatsappLabels,
  listWhatsappNumbers,
  summarizeByMonth,
  summarizeByWhatsapp,
} from "@/lib/db";
import type { InvoiceFilters } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseFilters(request: NextRequest): InvoiceFilters {
  const whatsappParams = request.nextUrl.searchParams.getAll("whatsapp");
  const whatsappNumbers = whatsappParams
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  const issueDateFrom =
    request.nextUrl.searchParams.get("issueFrom") ?? undefined;
  const issueDateTo =
    request.nextUrl.searchParams.get("issueTo") ?? undefined;

  return {
    whatsappNumbers:
      whatsappNumbers.length > 0 ? [...new Set(whatsappNumbers)] : undefined,
    issueDateFrom: issueDateFrom || undefined,
    issueDateTo: issueDateTo || undefined,
  };
}

export async function GET(request: NextRequest) {
  try {
    const filters = parseFilters(request);
    const labels = getWhatsappLabelMap();

    const numbers = listWhatsappNumbers();
    const summary = summarizeByWhatsapp(filters);
    const monthly = summarizeByMonth(filters);
    const stats = getStats(filters);

    return NextResponse.json({
      numbers,
      summary,
      monthly,
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
