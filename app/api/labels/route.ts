import { NextRequest, NextResponse } from "next/server";
import { deleteWhatsappLabel, setWhatsappLabel } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      whatsappNumber?: string;
      displayName?: string;
    };

    const label = setWhatsappLabel(
      body.whatsappNumber ?? "",
      body.displayName ?? "",
    );

    return NextResponse.json(label);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao salvar apelido";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const whatsappNumber =
      request.nextUrl.searchParams.get("whatsapp") ?? undefined;
    if (!whatsappNumber) {
      return NextResponse.json(
        { error: "Parâmetro whatsapp é obrigatório." },
        { status: 400 },
      );
    }

    deleteWhatsappLabel(whatsappNumber);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao remover apelido";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
