import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { usePoll } from "../../src/components/customer/use-poll";
type Value = { status: string };
const nativeTimeout = window.setTimeout.bind(window);
const timers = new Map<
  number,
  { at: number; delay: number; run: () => void }
>();
let clock = 0,
  sequence = 100000;
const fixture = {
  status: "PROOF_SUBMITTED",
  requests: 0,
  aborts: 0,
  hidden: false,
  fail: false,
  hold: false,
  setEnabled: (_value: boolean) => {},
  timers: () => [...timers.values()].map((t) => t.delay),
  async advance(ms: number) {
    clock += ms;
    const due = [...timers].filter(([, timer]) => timer.at <= clock);
    for (const [id, timer] of due) {
      timers.delete(id);
      timer.run();
    }
    await new Promise((resolve) => nativeTimeout(resolve, 25));
  },
};
declare global {
  interface Window {
    pollingFixture: typeof fixture;
  }
}
window.pollingFixture = fixture;
Object.defineProperty(document, "hidden", {
  configurable: true,
  get: () => fixture.hidden,
});
const clear = window.clearTimeout.bind(window);
window.setTimeout = ((run: TimerHandler, ms = 0, ...args: unknown[]) => {
  if (typeof run !== "function" || ms < 1000)
    return nativeTimeout(run, ms, ...args);
  const id = ++sequence;
  timers.set(id, { at: clock + ms, delay: ms, run: () => run(...args) });
  return id;
}) as typeof window.setTimeout;
window.clearTimeout = ((id?: number) => {
  if (id !== undefined) timers.delete(id);
  clear(id);
}) as typeof window.clearTimeout;
window.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  fixture.requests++;
  if (fixture.hold)
    return new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener(
        "abort",
        () => {
          fixture.aborts++;
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      ),
    );
  return Response.json(
    { status: fixture.status },
    { status: fixture.fail ? 503 : 200 },
  );
}) as typeof fetch;
function Harness() {
  const [enabled, setEnabled] = useState(false);
  const [render, setRender] = useState(0);
  useEffect(() => {
    fixture.setEnabled = setEnabled;
  }, [setEnabled]);
  const poll = usePoll<Value>("/fixture-status", {
    enabled,
    interval: (data) => (data?.status === "APPROVED" ? 60000 : 8000),
    terminal: (data) =>
      data.status === "REFUNDED" || data.status === "REJECTED",
  });
  return (
    <main>
      <h1>Polling acceptance</h1>
      <output>{poll.data?.status ?? "disabled"}</output>
      <p role="alert">{poll.error}</p>
      <span>{render}</span>
      <button onClick={poll.refresh}>Refresh</button>
      <button onClick={() => setRender((n) => n + 1)}>Rerender</button>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
