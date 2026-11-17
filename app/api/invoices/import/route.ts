import { NextRequest, NextResponse } from "next/server";
import { decodePdfBase64, importInvoicePdfs } from "@/lib/import-invoices";
import type { InvoicePdfInput } from "@/lib/import-invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = new Set([
  "https://app.360dialog.com",
  "https://hub.360dialog.com",
]);

function corsHeaders(request: NextRequest): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
  const origin = request.headers.get("origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function json(request: NextRequest, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(request) });
}

export function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export function GET(request: NextRequest) {
  return json(request, { ok: true });
}

async function readUploads(request: NextRequest): Promise<InvoicePdfInput[]> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      name?: string;
      dataBase64?: string;
      files?: Array<{ name?: string; dataBase64?: string }>;
    };
    const entries =
      body.files ??
      (body.dataBase64
        ? [{ name: body.name, dataBase64: body.dataBase64 }]
        : []);
    return entries.map((entry, index) => ({
      name: entry.name?.trim() || `fatura-${index + 1}.pdf`,
      bytes: decodePdfBase64(
        entry.name?.trim() || `fatura-${index + 1}.pdf`,
        entry.dataBase64 ?? "",
      ),
    }));
  }

  if (contentType.includes("application/pdf")) {
    const bytes = Buffer.from(await request.arrayBuffer());
    return [{ name: "fatura.pdf", bytes }];
  }

  const form = await request.formData();
  const files = form.getAll("file").filter((entry) => entry instanceof File);
  return Promise.all(
    files.map(async (file) => ({
      name: file.name || "fatura.pdf",
      bytes: Buffer.from(await file.arrayBuffer()),
    })),
  );
}

export async function POST(request: NextRequest) {
  try {
    const files = await readUploads(request);
    if (files.length === 0) {
      return json(
        request,
        { error: "Envie ao menos um PDF de fatura." },
        400,
      );
    }
    const result = await importInvoicePdfs(files);
    return json(request, result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao importar faturas";
    return json(request, { error: message }, 400);
  }
}
