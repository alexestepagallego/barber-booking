import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { emailFrom } from "@/server/config";

export type EmailAttachment = { filename: string; content: string; contentType: string };

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  /** Same key → the provider sends the email at most once (safe retries). */
  idempotencyKey?: string;
};

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/**
 * Resend's REST API, called with fetch: one endpoint does not justify an SDK.
 * https://resend.com/docs/api-reference/emails/send-email
 */
export function resendTransport(apiKey: string, from = emailFrom()): EmailTransport {
  return {
    name: "resend",
    async send(message) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(message.idempotencyKey && { "Idempotency-Key": message.idempotencyKey }),
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          attachments: message.attachments?.map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.content).toString("base64"),
            content_type: a.contentType,
          })),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`Resend responded ${response.status}: ${await response.text()}`);
      }
    },
  };
}

/**
 * Development: writes each email to ./.mail as an .html file you can open
 * in a browser, plus its attachments, and logs the path.
 */
export function fileTransport(directory = path.join(process.cwd(), ".mail")): EmailTransport {
  return {
    name: "file",
    async send(message) {
      await mkdir(directory, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const slug = message.subject
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 40);
      const base = path.join(directory, `${stamp}-${slug}`);
      await writeFile(`${base}.html`, message.html);
      for (const attachment of message.attachments ?? []) {
        await writeFile(`${base}-${attachment.filename}`, attachment.content);
      }
      console.info(`[email] "${message.subject}" → ${message.to} saved to ${base}.html`);
    },
  };
}

/** Serverless without an email provider: only log that an email would be sent. */
export function logTransport(): EmailTransport {
  return {
    name: "log",
    async send(message) {
      console.info(`[email] (not sent, no provider configured) "${message.subject}"`);
    },
  };
}

/** Tests: keeps every message in memory so assertions can inspect them. */
export function memoryTransport(): EmailTransport & { outbox: EmailMessage[] } {
  const outbox: EmailMessage[] = [];
  return {
    name: "memory",
    outbox,
    async send(message) {
      outbox.push(message);
    },
  };
}

let override: EmailTransport | undefined;

/** Lets tests (or scripts) swap the transport. Pass undefined to restore the default. */
export function setEmailTransport(transport: EmailTransport | undefined) {
  override = transport;
}

/**
 * Resend when RESEND_API_KEY is set; otherwise files locally and plain logs
 * on Vercel, whose file system is read-only.
 */
export function getEmailTransport(): EmailTransport {
  if (override) return override;
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) return resendTransport(apiKey);
  if (process.env.VERCEL) return logTransport();
  return fileTransport();
}
