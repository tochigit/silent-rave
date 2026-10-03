import jsQR from "jsqr";
import {
  mergeManifest,
  offlineDecision,
  verifyLocally,
  type LocalState,
  type Manifest,
  type SavedScan,
} from "../lib/scanner/local";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const status = $("status"),
  result = $("result"),
  eventSelect = $<HTMLSelectElement>("event"),
  camera = $<HTMLVideoElement>("camera");
let state: LocalState | undefined,
  currentUser: string | undefined,
  scanning = false,
  busy = false,
  stream: MediaStream | undefined;
let retry = 0,
  syncTimer: ReturnType<typeof setTimeout> | undefined;
let authBlocked = false;
const storeReady = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("silent-rave-scanner", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("state");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () =>
    reject(
      new Error("Local storage unavailable. Offline scanning is disabled."),
    );
});
async function readState() {
  const db = await storeReady;
  return new Promise<LocalState | undefined>((resolve, reject) => {
    const tx = db.transaction("state");
    const r = tx.objectStore("state").get("current");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
// Serialized UI mutations plus one read-write IDB transaction prevent double
// admission in another tab on this device. Local result follows durable commit.
async function mutate(
  update: (saved: LocalState | undefined) => LocalState | undefined,
) {
  const db = await storeReady;
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("state", "readwrite"),
      store = tx.objectStore("state"),
      r = store.get("current");
    let next: LocalState | undefined;
    r.onsuccess = () => {
      try {
        next = update(r.result);
        if (next) store.put(next, "current");
        else store.delete("current");
      } catch (e) {
        tx.abort();
        reject(e);
      }
    };
    tx.oncomplete = () => {
      state = next;
      render();
      resolve();
    };
    tx.onerror = () =>
      reject(new Error("Could not save scan. Do not admit yet."));
  });
}
function show(message: string, kind = "info") {
  result.textContent = message;
  result.dataset.kind = kind;
}
function render() {
  if (!state) {
    status.textContent = "Not prepared. Connect and prepare before scanning.";
    return;
  }
  const age = Math.max(
    0,
    Math.floor((Date.now() - new Date(state.syncedAt).getTime()) / 60000),
  );
  const ended =
    Date.now() + state.offset >=
    new Date(state.manifest.offline_until).getTime();
  status.textContent = `${navigator.onLine ? "Connection available" : "OFFLINE"} · ${state.manifest.event_title} · Last sync ${age} min ago · ${state.outbox.length} pending scans${ended ? " · PREPARATION EXPIRED" : ""}`;
  $("offline-warning").hidden = navigator.onLine && !state.outbox.length;
  $("attendees").textContent = "";
  if (!ended)
    for (const ticket of state.manifest.tickets
      .filter(
        (t) =>
          !$("search").getAttribute("data-query") ||
          (t.holder_name ?? "")
            .toLowerCase()
            .includes($("search").getAttribute("data-query")!),
      )
      .slice(0, 100)) {
      const row = document.createElement("li");
      row.textContent = `${ticket.holder_name ?? "Unnamed ticket"} · ${ticket.tier_name} · ${ticket.voided ? "VOID" : ticket.check_in_status.replaceAll("_", " ")}`;
      $("attendees").append(row);
    }
}
async function api(url: string, data?: unknown) {
  const response = await fetch(url, {
    cache: "no-store",
    method: data ? "POST" : "GET",
    headers: data ? { "content-type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  const value = await response.json();
  if (!response.ok) {
    const e = new Error(value.error ?? "Request failed.") as Error & {
      status: number;
    };
    e.status = response.status;
    if (response.status === 401 || response.status === 403) authBlocked = true;
    throw e;
  }
  return value;
}
async function identify() {
  const user = await api("/api/staff/session");
  currentUser = user.id;
  authBlocked = false;
  if (state && state.userId !== currentUser)
    throw new Error(
      "Another account has saved scans on this device. Export them, then clear preparation before changing account.",
    );
  $("login").hidden = true;
  return user;
}
async function expirePreparation() {
  if (
    !state ||
    Date.now() + state.offset < new Date(state.manifest.ends_at).getTime() ||
    !state.manifest.tickets.length
  )
    return;
  // Clear holder data at event end, while preserving unsynced admission evidence.
  await mutate(
    (saved) =>
      saved && { ...saved, manifest: { ...saved.manifest, tickets: [] } },
  );
}
async function loadEvents() {
  await identify();
  const response = await api("/api/staff/events");
  eventSelect.textContent = "";
  for (const event of response.events) {
    const option = document.createElement("option");
    option.value = event.id;
    option.textContent = event.title;
    eventSelect.append(option);
  }
  if (state) eventSelect.value = state.manifest.event_id;
}
async function prepare() {
  if (busy) return;
  busy = true;
  try {
    await identify();
    if (!eventSelect.value) throw new Error("Select an event.");
    if (state?.outbox.length) {
      await sync();
      if (state?.outbox.length)
        throw new Error("Sync pending scans before changing preparation.");
    }
    const manifest: Manifest = await api(
      `/api/staff/events/${eventSelect.value}/manifest`,
    );
    if (manifest.cancelled) throw new Error("This event is cancelled.");
    const userId = currentUser!;
    await mutate((old) => ({
      userId,
      deviceId: old?.deviceId ?? crypto.randomUUID(),
      manifest,
      syncedAt: new Date().toISOString(),
      offset: new Date(manifest.server_time).getTime() - Date.now(),
      outbox: [],
    }));
    if (!navigator.serviceWorker)
      throw new Error(
        "This browser cannot cache the offline scanner. Use a supported browser before relying on offline reload.",
      );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  "Offline cache is not ready. Stay connected and retry preparation.",
                ),
              ),
            12000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    show("Prepared. The scanner can now work during a network outage.");
  } catch (error) {
    show((error as Error).message, "error");
  } finally {
    busy = false;
  }
}
let syncing = false;
async function sync() {
  if (syncing || !state) return;
  syncing = true;
  try {
    await identify();
    do {
      const saved = await readState();
      if (!saved) return;
      const scans = saved.outbox.slice(0, 100);
      const response = await api("/api/staff/check-in/batch", {
        device_id: saved.deviceId,
        event_id: saved.manifest.event_id,
        clock_offset_ms: 0,
        since: saved.manifest.next_since,
        scans,
      });
      const received = new Set<string>(
        response.results.map(
          (r: { client_scan_id: string }) => r.client_scan_id,
        ),
      );
      const conflicts = response.results.filter((r: { result: string }) =>
        ["conflict", "duplicate", "void", "invalid", "wrong_event"].includes(
          r.result,
        ),
      );
      await mutate((old) => {
        if (
          !old ||
          old.userId !== saved.userId ||
          old.manifest.event_id !== saved.manifest.event_id
        )
          throw new Error("Preparation changed during sync.");
        const outbox = old.outbox.filter(
          (s) => !received.has(s.client_scan_id),
        );
        return {
          ...old,
          outbox,
          manifest: mergeManifest(old.manifest, response.manifest, outbox),
          syncedAt: new Date().toISOString(),
          offset:
            new Date(response.manifest.server_time).getTime() - Date.now(),
        };
      });
      if (conflicts.length)
        show(
          `${conflicts.length} scan conflict or void result. Owner review required; do not admit again.`,
          "error",
        );
      if (!scans.length) break;
    } while (state?.outbox.length);
    retry = 0;
  } catch (error) {
    retry++;
    const e = error as Error & { status?: number };
    show(
      e.status === 401 || e.status === 403
        ? "Sign in again to sync. Your pending scans are saved."
        : `Sync failed. ${e.message} Pending scans are saved.`,
      "error",
    );
    if (e.status === 401 || e.status === 403) $("login").hidden = false;
  } finally {
    syncing = false;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(
      () => {
        if (!document.hidden) void sync();
      },
      Math.min(60000, 10000 * 2 ** retry),
    );
  }
}
async function admitOffline(token: string) {
  const preview = state && offlineDecision(state, token);
  if (
    preview?.result === "unlisted" &&
    !confirm(preview.message + " Admit this ticket?")
  )
    return;
  let decision = preview;
  await mutate((saved) => {
    if (!saved) throw new Error("Prepare before scanning.");
    decision = offlineDecision(saved, token);
    if (!["valid", "unlisted"].includes(decision.result)) return saved;
    const scan: SavedScan = {
      client_scan_id: crypto.randomUUID(),
      token,
      event_id: saved.manifest.event_id,
      scanned_at: new Date(Date.now() + saved.offset).toISOString(),
      ...(decision.result === "unlisted" ? { not_in_manifest: true } : {}),
    };
    const ticketId = verifyLocally(token, saved.manifest.public_keys)!.ticketId;
    return {
      ...saved,
      outbox: [...saved.outbox, scan],
      manifest: {
        ...saved.manifest,
        tickets: saved.manifest.tickets.map((t) =>
          t.id === ticketId
            ? {
                ...t,
                check_in_status: "CHECKED_IN",
                checked_in_at: scan.scanned_at,
              }
            : t,
        ),
      },
    };
  });
  if (decision)
    show(
      `OFFLINE · ${decision.result.toUpperCase()} · ${decision.message}`,
      ["valid", "unlisted"].includes(decision.result) ? "valid" : "error",
    );
}
async function scanToken(token: string) {
  if (busy || syncing) return;
  busy = true;
  try {
    state = await readState();
    if (authBlocked || (currentUser && state?.userId !== currentUser))
      throw new Error(
        "Sign in as the preparing staff member before continuing. Pending scans remain saved.",
      );
    if (!state) throw new Error("Connect and prepare before scanning.");
    // Unsynced local admissions must be reconciled before taking the online path.
    if (!navigator.onLine || state.outbox.length) await admitOffline(token);
    else {
      const scanId = crypto.randomUUID();
      try {
        const response = await api("/api/staff/check-in", {
          token,
          event_id: state.manifest.event_id,
          device_id: state.deviceId,
          client_scan_id: scanId,
        });
        const decoded = verifyLocally(token, state.manifest.public_keys);
        if (decoded && ["valid", "duplicate"].includes(response.result))
          await mutate(
            (old) =>
              old && {
                ...old,
                manifest: {
                  ...old.manifest,
                  tickets: old.manifest.tickets.map((t) =>
                    t.id === decoded.ticketId
                      ? {
                          ...t,
                          check_in_status: "CHECKED_IN",
                          checked_in_at: response.checked_in_at,
                        }
                      : t,
                  ),
                },
              },
          );
        show(
          `${response.result.toUpperCase()} · ${response.tier_name ?? ""} · ${response.holder_name ?? ""}${response.result === "duplicate" ? ` · Already scanned ${response.checked_in_at ?? ""}` : ""}`,
          response.result === "valid" ? "valid" : "error",
        );
      } catch (error) {
        const e = error as Error & { status?: number };
        if (e.status) throw e; // auth/server rejection must never turn into an offline admit
        // Unknown online outcome: save SAME scan ID for reconciliation. Prevent
        // double admit on this phone, and prominently mark provisional admission.
        let decision: ReturnType<typeof offlineDecision> | undefined;
        await mutate((old) => {
          if (!old) throw new Error("Preparation lost.");
          decision = offlineDecision(old, token);
          if (decision.result !== "valid") return old;
          return {
            ...old,
            outbox: [
              ...old.outbox,
              {
                client_scan_id: scanId,
                token,
                event_id: old.manifest.event_id,
                scanned_at: new Date(Date.now() + old.offset).toISOString(),
              },
            ],
            manifest: {
              ...old.manifest,
              tickets: old.manifest.tickets.map((t) =>
                t.id === decision!.ticketId
                  ? {
                      ...t,
                      check_in_status: "CHECKED_IN",
                      checked_in_at: new Date().toISOString(),
                    }
                  : t,
              ),
            },
          };
        });
        show(
          decision?.result === "valid"
            ? `OFFLINE · PROVISIONAL VALID · ${decision.message}. Sync to confirm the server result.`
            : `Could not confirm: ${decision?.message ?? "retry when connected"}`,
          decision?.result === "valid" ? "valid" : "error",
        );
      }
    }
  } catch (error) {
    show((error as Error).message, "error");
  } finally {
    busy = false;
  }
}
async function startCamera() {
  if (!state) {
    show("Prepare the event before starting the camera.", "error");
    return;
  }
  try {
    stopCamera();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false,
    });
    camera.srcObject = stream;
    camera.hidden = false;
    await camera.play();
    scanning = true;
    const canvas = document.createElement("canvas"),
      context = canvas.getContext("2d", { willReadFrequently: true })!;
    let last = "",
      lastAt = 0;
    const frame = () => {
      if (!scanning) return;
      if (camera.readyState >= 2 && !busy && !syncing && !document.hidden) {
        canvas.width = camera.videoWidth;
        canvas.height = camera.videoHeight;
        context.drawImage(camera, 0, 0);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(image.data, image.width, image.height, {
          inversionAttempts: "dontInvert",
        });
        if (code && (code.data !== last || Date.now() - lastAt > 2500)) {
          last = code.data;
          lastAt = Date.now();
          void scanToken(code.data);
        }
      }
      setTimeout(frame, 160);
    };
    frame();
  } catch {
    show(
      "Camera access unavailable. Allow camera permission, use HTTPS, or choose a QR image / enter its token.",
      "error",
    );
  }
}
function stopCamera() {
  scanning = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = undefined;
  camera.srcObject = null;
  camera.hidden = true;
}
$("prepare").onclick = () => void prepare();
$("sync").onclick = () => void sync();
$("start-camera").onclick = () => void startCamera();
$("stop-camera").onclick = stopCamera;
$("manual-form").onsubmit = (e) => {
  e.preventDefault();
  void scanToken($<HTMLTextAreaElement>("token").value.trim());
};
$<HTMLInputElement>("qr-image").onchange = async (e) => {
  try {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const image = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    canvas.width = Math.floor(image.width * scale);
    canvas.height = Math.floor(image.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const qr = jsQR(pixels.data, pixels.width, pixels.height);
    if (!qr) throw new Error("No QR found in this image.");
    await scanToken(qr.data);
  } catch (error) {
    show((error as Error).message, "error");
  }
};
$("search").oninput = (e) => {
  $("search").setAttribute(
    "data-query",
    (e.target as HTMLInputElement).value.toLowerCase(),
  );
  render();
};
$("export").onclick = () => {
  if (!state?.outbox.length) {
    show("No pending scans to export.");
    return;
  }
  const blob = new Blob(
    [
      JSON.stringify({
        device_id: state.deviceId,
        event_id: state.manifest.event_id,
        clock_offset_ms: 0,
        scans: state.outbox,
      }),
    ],
    { type: "application/json" },
  );
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "SilentRave-pending-scans.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
$("clear").onclick = async () => {
  if (
    !confirm(
      state?.outbox.length
        ? "Pending scans will be lost unless you exported them. Clear this device?"
        : "Clear this device's preparation?",
    )
  )
    return;
  stopCamera();
  await mutate(() => undefined);
  show("Device preparation cleared.");
};
$("logout").onclick = async () => {
  if (state?.outbox.length) {
    show(
      "Sync or export and explicitly clear pending scans before logging out.",
      "error",
    );
    return;
  }
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error();
    stopCamera();
    await mutate(() => undefined);
    location.assign("/staff/login");
  } catch {
    show(
      "Connect to complete logout. Your session and preparation are still present.",
      "error",
    );
  }
};
addEventListener("online", () => {
  render();
  void loadEvents().catch((e) => show(e.message, "error"));
  void sync();
});
addEventListener("offline", render);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopCamera();
  else {
    render();
    void sync();
  }
});
async function boot() {
  try {
    state = await readState();
    await expirePreparation();
    render();
    if (navigator.onLine)
      await navigator.serviceWorker?.register("/scanner-sw.js", { scope: "/" });
    await loadEvents();
    void sync();
  } catch (error) {
    show((error as Error).message, "error");
  }
}
void boot();
setInterval(() => {
  render();
  void expirePreparation().catch(() =>
    show("Could not clear ended-event preparation.", "error"),
  );
}, 30000);
