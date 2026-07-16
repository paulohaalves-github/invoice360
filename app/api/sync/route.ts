import { NextResponse } from "next/server";
import { syncInvoicesFromImap } from "@/lib/imap-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await syncInvoicesFromImap();
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao sincronizar e-mails";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
