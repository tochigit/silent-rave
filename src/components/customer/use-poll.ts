"use client";
import { useCallback, useEffect, useRef, useState } from "react";
export function usePoll<T>(
  url: string,
  {
    token,
    interval = 8000,
    enabled = true,
    terminal = () => false,
  }: {
    token?: string;
    interval?: number | ((data: T | null) => number);
    enabled?: boolean;
    terminal?: (data: T) => boolean;
  } = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [version, setVersion] = useState(0);
  const terminalRef = useRef(terminal);
  const intervalRef = useRef(interval);
  const latestRef = useRef<{ url: string; token?: string; data: T | null }>({
    url,
    token,
    data: null,
  });
  useEffect(() => {
    terminalRef.current = terminal;
    intervalRef.current = interval;
  }, [terminal, interval]);
  const refresh = useCallback(() => setVersion((n) => n + 1), []);
  useEffect(() => {
    if (!enabled) return;
    if (latestRef.current.url !== url || latestRef.current.token !== token)
      latestRef.current = { url, token, data: null };
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let failures = 0;
    let stopped = false;
    let generation = 0;
    let latest = latestRef.current.data;
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
        latest = value;
        latestRef.current = { url, token, data: value };
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
        if (active && current === generation && !stopped && !document.hidden) {
          const base =
            typeof intervalRef.current === "function"
              ? intervalRef.current(latest)
              : intervalRef.current;
          timer = setTimeout(
            poll,
            Math.min(60000, Math.max(1000, base) * 2 ** failures),
          );
        }
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
  }, [url, token, enabled, version]);
  return { data, error, notFound, refresh };
}
