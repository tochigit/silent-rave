"use client";
import { useCallback, useEffect, useRef, useState } from "react";
export function usePoll<T>(
  url: string,
  {
    token,
    interval = 8000,
    terminal = () => false,
  }: {
    token?: string;
    interval?: number;
    terminal?: (data: T) => boolean;
  } = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [version, setVersion] = useState(0);
  const terminalRef = useRef(terminal);
  useEffect(() => {
    terminalRef.current = terminal;
  }, [terminal]);
  const refresh = useCallback(() => setVersion((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let failures = 0;
    let stopped = false;
    let generation = 0;
    async function poll() {
      if (!active || stopped || document.hidden) return;
      const current = ++generation;
      const request = (controller = new AbortController());
      const timeout = setTimeout(() => request.abort(), 30000);
      try {
        const r = await fetch(url, {
          headers: token ? { "x-status-token": token } : {},
          cache: "no-store",
          signal: request.signal,
        });
        if (!active || current !== generation) return;
        if (r.status === 404) {
          setNotFound(true);
          stopped = true;
          return;
        }
        if (!r.ok) throw new Error();
        const value: T = await r.json();
        if (!active || current !== generation) return;
        setData(value);
        setError("");
        setNotFound(false);
        failures = 0;
        stopped = terminalRef.current(value);
      } catch (e) {
        if (active && current === generation) {
          failures++;
          setError(
            "Could not refresh. Your last saved status is shown; retry when connected.",
          );
        }
      } finally {
        clearTimeout(timeout);
        if (active && current === generation && !stopped && !document.hidden)
          timer = setTimeout(poll, Math.min(60000, interval * 2 ** failures));
      }
    }
    function visibility() {
      generation++;
      clearTimeout(timer);
      controller?.abort();
      if (!document.hidden && !stopped) void poll();
    }
    void poll();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      generation++;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [url, token, interval, version]);
  return { data, error, notFound, refresh };
}
