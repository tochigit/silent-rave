import { deploymentId, internalOrigin } from "@/lib/hosting/config";
import type { Decision, DecisionRequest } from "./policy";
export async function sessionDecision(input: DecisionRequest, send: typeof fetch = fetch): Promise<Decision> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      void reader?.cancel().catch(() => {});
      reject(new Error("Broker deadline exceeded"));
    }, 8000);
  });
  try {
    return await Promise.race([deadline, (async () => {
    const secret = process.env.PROXY_AUTH_SECRET;
    if (!secret || secret.length < 32) throw new Error("Missing broker key");
    const response = await send(`${internalOrigin()}/api/internal/session-decision`, {
      method: "POST", credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
      headers: { "content-type": "application/json", "x-proxy-auth": secret }, body: JSON.stringify(input),
    });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json")) throw new Error("Broker unavailable");
    reader = response.body?.getReader();
    if (!reader) throw new Error("Empty broker reply");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 2048) { await reader.cancel(); throw new Error("Oversized broker reply"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const result = JSON.parse(new TextDecoder().decode(bytes)) as Decision;
    if (!result || typeof result !== "object" || result.v !== 1 || result.deploymentId !== deploymentId() ||
      !["ALLOW", "UNAUTHENTICATED", "FORBIDDEN", "PASSWORD_CHANGE_REQUIRED"].includes(result.decision) ||
      Object.keys(result).some(k => !["v", "deploymentId", "decision", "renewExpiresAt"].includes(k)) ||
      (result.renewExpiresAt !== undefined && (result.decision !== "ALLOW" || typeof result.renewExpiresAt !== "string" ||
        !Number.isFinite(Date.parse(result.renewExpiresAt)) || Date.parse(result.renewExpiresAt) <= Date.now() || Date.parse(result.renewExpiresAt) > Date.now() + 13 * 3600000))) throw new Error("Invalid broker decision");
    return result;
    })()]);
  } finally { clearTimeout(timer!); }
}
