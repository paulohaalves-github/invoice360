import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  credentialsMatch,
  isAuthConfigured,
  sessionCookieOptions,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: "O acesso ainda não foi configurado no servidor." },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
  } | null;
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!(await credentialsMatch(email, password))) {
    return NextResponse.json(
      { error: "Usuário ou senha inválidos." },
      { status: 401 },
    );
  }

  const token = await createSessionToken(email);
  if (!token) {
    return NextResponse.json(
      { error: "Não foi possível iniciar a sessão." },
      { status: 500 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    ...sessionCookieOptions(request.nextUrl.protocol === "https:"),
    value: token,
  });
  return response;
}
