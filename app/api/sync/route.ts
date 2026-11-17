import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { syncInvoicesFromImap } from "@/lib/imap-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;

  try {
    const result = await syncInvoicesFromImap();
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao sincronizar e-mails";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
