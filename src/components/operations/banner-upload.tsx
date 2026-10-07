"use client";
import { useState } from "react";
import { prepareImage } from "@/lib/uploads/prepare-image";
import { uploadFailure } from "@/lib/uploads/messages";

export function BannerUpload({ eventId, onUploaded }: { eventId: string; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  async function upload() {
    if (!file || busy) return;
    setBusy(true); setError(""); setStatus("Preparing banner…");
    try {
      const prepared = await prepareImage(file, "banner");
      const form = new FormData(); form.set("banner", prepared);
      setStatus("Uploading banner…");
      const response = await fetch(`/api/admin/events/${eventId}/banner`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(uploadFailure(response.status, body.error));
      setStatus("Banner saved."); onUploaded();
    } catch (error) { setStatus(""); setError(error instanceof Error ? error.message : "Upload failed. Your image is saved; retry."); }
    finally { setBusy(false); }
  }
  return <div className="stack">
    <label>Banner image<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" disabled={busy} onChange={e => { setFile(e.target.files?.[0] ?? null); setError(""); setStatus(""); }} /></label>
    <small>Prepared under 3 MiB. HEIC conversion depends on your browser.</small>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <button type="button" disabled={busy || !file} onClick={() => void upload()}>{busy ? "Uploading…" : error ? "Retry banner upload" : "Upload banner"}</button>
  </div>;
}
