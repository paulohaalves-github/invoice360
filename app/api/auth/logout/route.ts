import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    ...sessionCookieOptions(request.nextUrl.protocol === "https:"),
    value: "",
    maxAge: 0,
  });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
