import { NextRequest, NextResponse } from "next/server";
import {
  backfillCustomerEmails,
  backfillMissingWhatsappNumbers,
  getWhatsappLabelMap,
  listInvoiceRows,
  summarizeByWhatsapp,
} from "@/lib/db";
import { buildInvoicesWorkbook } from "@/lib/excel-export";
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
    const buffer = await buildInvoicesWorkbook({
      summary: summarizeByWhatsapp(filters),
      invoices: listInvoiceRows(filters),
      labels: getWhatsappLabelMap(),
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="invoice360.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao exportar planilha";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
