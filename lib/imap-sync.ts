import fs from "node:fs";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {
  emailExists,
  getPdfDir,
  insertEmail,
  saveInvoice,
} from "./db";
import { parse360DialogPdf } from "./pdf-parser";
import type { SyncResult } from "./types";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }
  return value;
}

function getImapConfig() {
  return {
    host: requireEnv("IMAP_HOST"),
    port: Number(process.env.IMAP_PORT || 993),
    secure: (process.env.IMAP_SECURE ?? "true").toLowerCase() !== "false",
    auth: {
      user: requireEnv("IMAP_USER"),
      pass: requireEnv("IMAP_PASS"),
    },
    logger: false as const,
  };
}

function isPdfAttachment(filename?: string | null, contentType?: string | null) {
  const name = (filename ?? "").toLowerCase();
  const type = (contentType ?? "").toLowerCase();
  return name.endsWith(".pdf") || type.includes("application/pdf");
}

/** Assunto deve conter o texto (não precisa ser igual). */
function subjectMatchesFilter(
  subject: string | null | undefined,
  needle: string,
): boolean {
  if (!subject?.trim()) return false;
  return subject.toLowerCase().includes(needle.toLowerCase());
}

export async function syncInvoicesFromImap(): Promise<SyncResult> {
  const result: SyncResult = {
    processed: 0,
    imported: 0,
    skipped: 0,
    errors: [],
  };

  const folder = process.env.IMAP_FOLDER?.trim() || "INBOX";
  const searchSubject =
    process.env.IMAP_SEARCH_SUBJECT?.trim() || "Your 360dialog invoice";
  // 0 ou vazio = sem limite (varre toda a pasta)
  const maxScanRaw = process.env.IMAP_MAX_MESSAGES?.trim();
  const maxScan =
    maxScanRaw === undefined || maxScanRaw === "" || maxScanRaw === "0"
      ? 0
      : Number(maxScanRaw);
  const config = getImapConfig();
  const client = new ImapFlow(config);
  client.on("error", () => {
    // Evita uncaughtException quando o servidor encerra a conexão (ECONNRESET).
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock(folder);
    try {
      // Busca todos os e-mails da pasta; filtra só pelo assunto no app.
      const uids = await client.search({ all: true }, { uid: true });

      if (!uids || uids.length === 0) {
        return result;
      }

      const sorted = [...uids].sort((a, b) => b - a);
      const toScan = maxScan > 0 ? sorted.slice(0, maxScan) : sorted;
      const matchingUids: number[] = [];

      for await (const message of client.fetch(
        toScan,
        { uid: true, envelope: true },
        { uid: true },
      )) {
        if (subjectMatchesFilter(message.envelope?.subject, searchSubject)) {
          matchingUids.push(message.uid);
        }
      }

      if (matchingUids.length === 0) {
        return result;
      }

      for await (const message of client.fetch(
        matchingUids,
        {
          uid: true,
          envelope: true,
          source: true,
        },
        { uid: true },
      )) {
        try {
          const subject = message.envelope?.subject ?? null;

          if (!subjectMatchesFilter(subject, searchSubject)) {
            continue;
          }

          result.processed += 1;

          if (!message.source) {
            result.errors.push(`UID ${message.uid}: e-mail sem conteúdo`);
            continue;
          }

          const parsedMail = await simpleParser(message.source);
          const messageId =
            parsedMail.messageId?.trim() ||
            `uid-${message.uid}@${config.host}`;

          if (emailExists(messageId)) {
            result.skipped += 1;
            continue;
          }

          const resolvedSubject = parsedMail.subject ?? subject;

          const fromAddress =
            parsedMail.from?.text ??
            message.envelope?.from?.[0]?.address ??
            null;
          const receivedAt =
            parsedMail.date?.toISOString() ??
            message.envelope?.date?.toISOString() ??
            null;

          const attachments = parsedMail.attachments.filter((att) =>
            isPdfAttachment(att.filename, att.contentType),
          );

          // Sem PDF: registra para não reprocessar eternamente
          if (attachments.length === 0) {
            insertEmail({
              messageId,
              subject: resolvedSubject,
              fromAddress,
              receivedAt,
            });
            result.skipped += 1;
            continue;
          }

          let importedAny = false;
          let savedAny = false;
          const parseErrors: string[] = [];
          let emailId: number | null = null;

          for (const attachment of attachments) {
            try {
              const parsedInvoice = await parse360DialogPdf(attachment.content);
              const safeName = parsedInvoice.invoiceNumber.replace(
                /[^\w.-]+/g,
                "_",
              );
              const pdfPath = path.join(getPdfDir(), `${safeName}.pdf`);
              fs.writeFileSync(pdfPath, attachment.content);

              if (emailId == null) {
                emailId = insertEmail({
                  messageId,
                  subject: resolvedSubject,
                  fromAddress,
                  receivedAt,
                });
              }

              const saved = saveInvoice({
                parsed: parsedInvoice,
                sourceEmailId: emailId,
                emailSubject: resolvedSubject,
                pdfPath,
              });

              savedAny = true;
              if (saved.created) {
                importedAny = true;
              }
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : "Erro ao processar PDF";
              parseErrors.push(
                `UID ${message.uid} / ${attachment.filename ?? "anexo"}: ${msg}`,
              );
            }
          }

          if (importedAny) {
            result.imported += 1;
          } else if (!savedAny && parseErrors.length > 0) {
            // Nenhum PDF válido — mantém para retry no próximo sync
            result.errors.push(...parseErrors);
          } else {
            result.skipped += 1;
            if (parseErrors.length > 0) {
              result.errors.push(...parseErrors);
            }
          }
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : "Erro ao processar e-mail";
          result.errors.push(`UID ${message.uid}: ${msg}`);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      // Ignora falha ao encerrar (ex.: ECONNRESET).
    }
  }

  return result;
}
