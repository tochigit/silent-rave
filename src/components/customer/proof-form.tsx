"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { compressProof } from "@/lib/customer/compress-proof";
export function ProofForm({
  code,
  token,
  onSubmitted,
}: {
  code: string;
  token: string;
  onSubmitted: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [sender, setSender] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("");
  const submission = useRef<string | null>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const prepared = useRef<{ original: File; compressed: File } | null>(null);
  useEffect(
    () => () => {
      xhr.current?.abort();
    },
    [],
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setProgress(0);
    setStage("Preparing receipt…");
    submission.current ??= crypto.randomUUID();
    try {
      const compressed =
        prepared.current?.original === file
          ? prepared.current.compressed
          : await compressProof(file);
      prepared.current = { original: file, compressed };
      const form = new FormData();
      form.set("proof", compressed);
      form.set("transfer_reference", reference);
      form.set("sender_name", sender);
      form.set("client_submission_id", submission.current);
      setStage("Uploading receipt…");
      await new Promise<void>((resolve, reject) => {
        const request = (xhr.current = new XMLHttpRequest());
        request.open("POST", `/api/orders/${encodeURIComponent(code)}/proof`);
        request.setRequestHeader("x-status-token", token);
        request.timeout = 120000;
        request.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setProgress(Math.round((e.loaded / e.total) * 100));
        };
        request.onload = () => {
          let body: { error?: string } = {};
          try {
            body = JSON.parse(request.responseText);
          } catch {}
          if (request.status >= 200 && request.status < 300) resolve();
          else
            reject(
              new Error(
                body.error ||
                  "Receipt was not accepted. Check your status and try again.",
              ),
            );
        };
        request.onerror = () =>
          reject(
            new Error(
              "Connection lost. Your fields and retry ID are saved in this form. Retry when connected.",
            ),
          );
        request.ontimeout = () =>
          reject(
            new Error(
              "Upload timed out. Check your status or retry with the same submission.",
            ),
          );
        request.onabort = () =>
          reject(new Error("Upload interrupted. Retry when connected."));
        request.send(form);
      });
      setStage(
        "Receipt received for owner review. Payment is not yet confirmed.",
      );
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed. Try again.");
      setStage("");
    } finally {
      setBusy(false);
      xhr.current = null;
    }
  }
  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>Submit your payment receipt</h2>
      <p className="muted">
        The owner checks the bank credit before approving tickets. Keep this
        page open or save your order link.
      </p>
      <fieldset disabled={busy} className="stack">
        <legend>Receipt details</legend>
        <label>
          Receipt image
          <input
            name="proof"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            required
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              prepared.current = null;
            }}
          />
          <small>
            JPEG, PNG or WebP, compressed under 4 MB. HEIC conversion depends on
            your browser.
          </small>
        </label>
        <label>
          Transfer reference
          <input
            name="transfer_reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={128}
            required
          />
          <small>Transaction/session ID printed on your bank receipt.</small>
        </label>
        <label>
          Sender name
          <input
            name="sender_name"
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            maxLength={200}
            required
          />
        </label>
      </fieldset>
      {busy && (
        <div role="status">
          <p>
            {stage} {progress}%
          </p>
          <progress
            value={progress}
            max={100}
            aria-label="Receipt upload progress"
          />
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!busy && stage && <p role="status">{stage}</p>}
      <button type="submit" className="purple" disabled={busy || !file}>
        {busy
          ? "Submitting…"
          : error
            ? "Retry receipt upload"
            : "I have paid — submit receipt"}
      </button>
    </form>
  );
}
