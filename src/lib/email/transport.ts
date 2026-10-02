import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { EMAIL, emailConfig } from "./config";

export type EmailPayload = {
  from: string; reply_to: string; to: string[]; subject: string; html: string; text: string;
  attachments: { filename: string; content: string }[];
  tags: { name: string; value: string }[];
};
export type SendOutcome = { ok: true; messageId: string } | {
  ok: false; transient: boolean; code: string; retryAfterMs?: number; quota?: boolean;
};
export interface EmailTransport {
  send(jobId: string, payload: EmailPayload): Promise<SendOutcome>;
}

export function retryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) && ms >= 0 ? Math.ceil(ms) : undefined;
}

/** Direct HTTPS; built-in fetch, no Resend SDK. Never log response bodies. */
export class ResendTransport implements EmailTransport {
  constructor(private apiKey: string, private request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch) {
    if (!apiKey) throw new Error("RESEND_API_KEY_REQUIRED");
  }
  async send(jobId: string, payload: EmailPayload): Promise<SendOutcome> {
    try {
      const response = await this.request("https://api.resend.com/emails", {
        method: "POST", headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", "Idempotency-Key": jobId },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(EMAIL.timeoutMs),
      });
      const body = await response.json().catch(() => null) as { id?: string; name?: string } | null;
      if (response.ok && body?.id) return { ok: true, messageId: body.id };
      const quota = body?.name === "daily_quota_exceeded" || body?.name === "monthly_quota_exceeded";
      return { ok: false, code: `HTTP_${response.status}`, quota,
        transient: response.status >= 500 || response.status === 429 || quota || (response.status === 409 && body?.name === "concurrent_idempotent_requests") || response.ok,
        retryAfterMs: retryAfter(response.headers.get("retry-after")),
      };
    } catch { return { ok: false, transient: true, code: "NETWORK_ERROR" }; }
  }
}

/** Private capture files; no route serves them, and production refuses capture. */
export class CaptureTransport implements EmailTransport {
  constructor(private root = path.join(process.env.LOCAL_STORAGE_DIR ?? ".storage-local", "email-capture")) {
    if (process.env.NODE_ENV === "production") throw new Error("CAPTURE_DEV_ONLY");
  }
  async send(jobId: string, payload: EmailPayload): Promise<SendOutcome> {
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new Error("INVALID_JOB_ID");
    await mkdir(this.root, { recursive: true });
    const file = path.join(this.root, `${jobId}.json`);
    try { await writeFile(file, JSON.stringify(payload), { mode: 0o600, flag: "wx" }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(file, "utf8");
      if (existing !== JSON.stringify(payload)) return { ok: false, transient: false, code: "HTTP_409" };
    }
    return { ok: true, messageId: `capture-${jobId}` };
  }
}

export function getEmailTransport(): EmailTransport {
  const config = emailConfig();
  return config.transport === "resend" ? new ResendTransport(config.apiKey) : new CaptureTransport();
}
