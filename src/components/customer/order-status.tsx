"use client";
import { useState } from "react";
import Link from "next/link";
import { usePoll } from "./use-poll";
import { ProofForm } from "./proof-form";
import { money, lagosDate } from "@/lib/customer/format";
import type { OrderStatusDTO } from "@/lib/customer/types";
export function Copy({ value, label }: { value: string; label: string }) {
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Copied");
    } catch {
      setMessage("Copy unavailable — select the text to copy it.");
    }
  }
  return (
    <span className="copy-row">
      <span>{value}</span>
      <button type="button" aria-label={`Copy ${label}`} onClick={copy}>
        Copy
      </button>
      {message && <small role="status">{message}</small>}
    </span>
  );
}
const titles: Record<OrderStatusDTO["status"], string> = {
  AWAITING_PAYMENT: "Awaiting your payment",
  PROOF_SUBMITTED: "Receipt received — review pending",
  NEEDS_RESUBMIT: "Please resubmit your receipt",
  APPROVED: "Your tickets are approved",
  REJECTED: "Order rejected",
  EXPIRED: "Reservation expired",
  REFUNDED: "Order refunded — tickets invalid",
};
export function OrderStatusPage({
  code,
  token,
}: {
  code: string;
  token: string;
}) {
  const { data, error, notFound, refresh } = usePoll<OrderStatusDTO>(
    `/api/orders/${encodeURIComponent(code)}/status`,
    {
      token,
      enabled: !!token,
      interval: (d) => (d?.status === "APPROVED" ? 60000 : 8000),
      terminal: (d) => d.status === "REJECTED" || d.status === "REFUNDED",
    },
  );
  if (!token || notFound)
    return (
      <section className="narrow panel">
        <h1>Order link unavailable</h1>
        <p>
          This link is invalid or incomplete. Use the full saved link, or
          request one using your order code and checkout email.
        </p>
        <Link className="button" href="/lookup">
          Recover order link
        </Link>
      </section>
    );
  if (!data)
    return (
      <section className="narrow panel" role={error ? "alert" : "status"}>
        <p>{error || "Loading your private order…"}</p>
        {error && <button onClick={refresh}>Retry order status</button>}
      </section>
    );
  const elapsed =
    data.hold_expires_at &&
    new Date(data.hold_expires_at).getTime() < Date.now();
  const expired =
    data.status === "EXPIRED" ||
    (elapsed &&
      ["AWAITING_PAYMENT", "PROOF_SUBMITTED", "NEEDS_RESUBMIT"].includes(
        data.status,
      ));
  return (
    <section className="narrow stack">
      <div className="panel status-heading">
        <p className="eyebrow">YOUR PRIVATE ORDER</p>
        <h1>{expired ? "Reservation expired" : titles[data.status]}</h1>
        <p>{data.event_title}</p>
        <Copy value={data.order_code} label="order code" />
        <p className="total">
          Order amount <strong>{money(data.amount_kobo)}</strong>
        </p>
        <p className="muted">
          Save this private page link. It works without waiting for email.
          Anyone with the link can see your order.
        </p>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="secondary" onClick={refresh}>
        Refresh order status
      </button>
      {data.status === "PROOF_SUBMITTED" && !expired && (
        <div className="panel">
          <h2>The owner is checking your payment</h2>
          <p>
            Your receipt is evidence, not payment confirmation. Tickets appear
            here only after owner approval.
          </p>
          <p>We refresh automatically while this page is visible.</p>
        </div>
      )}
      {expired && (
        <div className="panel">
          <h2>
            {data.pending_proof
              ? "Your receipt is still awaiting review"
              : "Your ticket reservation has lapsed"}
          </h2>
          <p>
            {data.pending_proof
              ? "The owner will check your payment. Your reservation has ended, so approval depends on remaining capacity. If tickets are unavailable, contact the organizer about a manual refund. Do not pay again."
              : data.can_submit_proof
                ? "If you already paid, you can still submit one receipt within the grace period. The owner will check it; tickets are no longer reserved. Do not make a new transfer for this expired reservation."
                : "No more receipts can be submitted for this order. If you paid, contact the organizer with your order code. Do not pay again."}
          </p>
          {data.late_proof_deadline && data.can_submit_proof && (
            <p>
              Late receipt deadline: {lagosDate(data.late_proof_deadline)} WAT
            </p>
          )}
          {data.late_proof_received && (
            <p>Your late receipt has been received for review.</p>
          )}
        </div>
      )}
      {data.rejection && (
        <div className="panel">
          <h2>
            {data.status === "NEEDS_RESUBMIT"
              ? "Receipt needs another look"
              : "Owner decision"}
          </h2>
          <p>{data.rejection.reason_code?.replaceAll("_", " ")}</p>
          <p className="prose">{data.rejection.message}</p>
          {data.status === "NEEDS_RESUBMIT" && (
            <p>
              {Math.max(0, 1 + data.max_resubmissions - data.proof_attempts)}{" "}
              submissions remaining. The original review deadline stays in
              place.
            </p>
          )}
        </div>
      )}
      {data.status === "REFUNDED" && (
        <div className="panel">
          <p>
            These tickets have been voided and cannot be used or downloaded.
            Refunds are handled manually by the owner; this page does not
            transfer money.
          </p>
        </div>
      )}
      {data.status === "APPROVED" && (
        <div className="panel stack">
          <h2>Download your tickets</h2>
          <p>One PDF per person. Keep it ready on your phone for entry.</p>
          {data.tickets?.map((t, i) => (
            <div key={t.ticket_id}>
              <p>
                Ticket {i + 1} · {t.tier_name}
                {t.holder_name ? ` · ${t.holder_name}` : ""}
              </p>
              {t.voided ? (
                <p className="error">This ticket is invalid.</p>
              ) : (
                <TicketDownload
                  url={t.pdf_url}
                  onInvalid={refresh}
                  label={`Download ticket ${i + 1} PDF`}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {data.can_submit_proof && (
        <>
          {!data.payment_account && (
            <p role="alert" className="panel">
              Recorded bank details are unavailable. Contact the organizer
              before making a transfer. If you already paid, you can submit your
              receipt below.
            </p>
          )}
          {data.payment_account && (
            <div className="bank-details">
              <h2>
                {expired ? "Recorded payment account" : "Bank transfer details"}
              </h2>
              <dl>
                <div>
                  <dt>Bank</dt>
                  <dd>{data.payment_account.bank_name}</dd>
                </div>
                <div>
                  <dt>Account number</dt>
                  <dd>
                    <Copy
                      value={data.payment_account.account_number}
                      label="account number"
                    />
                  </dd>
                </div>
                <div>
                  <dt>Account name</dt>
                  <dd>{data.payment_account.account_name}</dd>
                </div>
              </dl>
              {!expired && (
                <p>
                  Transfer exactly {money(data.amount_kobo)}. Put{" "}
                  <strong>{data.order_code}</strong> in your transfer narration.
                </p>
              )}
              <p>
                Receipt deadline:{" "}
                {data.hold_expires_at
                  ? lagosDate(data.hold_expires_at) + " WAT"
                  : "Not available"}
              </p>
            </div>
          )}
          <ProofForm
            key={`${data.order_code}-${data.proof_attempts}`}
            code={code}
            token={token}
            onSubmitted={refresh}
          />
        </>
      )}
      <p>
        <Link href="/contact" referrerPolicy="no-referrer">
          Contact the organizer
        </Link>{" "}
        · <Link href="/lookup">Recover an order link</Link>
      </p>
    </section>
  );
}
function TicketDownload({
  url,
  label,
  onInvalid,
}: {
  url: string;
  label: string;
  onInvalid: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(url, {
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      if (!r.ok) {
        if (r.status === 409 || r.status === 410) onInvalid();
        throw new Error(
          r.status === 410
            ? "This ticket is no longer valid."
            : r.status === 404
              ? "This ticket link is unavailable. Refresh your order."
              : "Ticket download failed. Try again.",
        );
      }
      const blob = await r.blob();
      const local = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = local;
      a.download = "SilentRave-ticket.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(local), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button onClick={download} disabled={busy}>
        {busy ? "Preparing PDF…" : label}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
