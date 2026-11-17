import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getInvoicePdf } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Fatura inválida." }, { status: 400 });
  }

  const file = getInvoicePdf(id);
  if (!file) {
    return NextResponse.json({ error: "PDF não encontrado." }, { status: 404 });
  }

  const bytes = fs.readFileSync(file.pdfPath);
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${file.invoiceNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
