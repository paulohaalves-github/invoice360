import { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE = "invoice360_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  sub: string;
  exp: number;
};

function authSecret(): string {
  return process.env.AUTH_SECRET?.trim() ?? "";
}

function expectedUser(): string {
  return (process.env.AUTH_USER ?? "").trim().toLowerCase();
}

function expectedPassword(): string {
  return process.env.AUTH_PASSWORD ?? "";
}

export function isAuthConfigured(): boolean {
  return Boolean(expectedUser() && expectedPassword() && authSecret());
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const padded =
      value.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

async function hmac(value: string): Promise<Uint8Array | null> {
  const secret = authSecret();
  if (!secret) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return new Uint8Array(signature);
}

async function valuesMatch(left: string, right: string): Promise<boolean> {
  const [leftMac, rightMac] = await Promise.all([hmac(left), hmac(right)]);
  if (!leftMac || !rightMac) return false;
  return timingSafeEqual(leftMac, rightMac);
}

export async function credentialsMatch(
  user: string,
  password: string,
): Promise<boolean> {
  if (!isAuthConfigured()) return false;
  const [userOk, passwordOk] = await Promise.all([
    valuesMatch(user.trim().toLowerCase(), expectedUser()),
    valuesMatch(password, expectedPassword()),
  ]);
  return userOk && passwordOk;
}

export async function createSessionToken(user: string): Promise<string | null> {
  const payload: SessionPayload = {
    sub: user.trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  };
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(encoded);
  if (!signature) return null;
  return `${encoded}.${bytesToBase64Url(signature)}`;
}

export async function readSession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token || !isAuthConfigured()) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = await hmac(encoded);
  const actual = base64UrlToBytes(signature);
  if (!expected || !actual || !timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(encoded) ?? new Uint8Array()),
    ) as SessionPayload;
    if (!payload?.sub || typeof payload.exp !== "number") return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (payload.sub !== expectedUser()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(secure: boolean) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_SECONDS,
  };
}

export async function requireSession(
  request: NextRequest,
): Promise<NextResponse | null> {
  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return null;
  return NextResponse.json(
    { error: "Faça login para continuar." },
    { status: 401 },
  );
}
