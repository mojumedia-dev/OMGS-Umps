"use client";

import { useEffect, useState } from "react";
import {
  savePushSubscription,
  removePushSubscription,
} from "./push-actions";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufferToBase64Url(buf: ArrayBuffer | null) {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default function PushToggle() {
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSupported(false);
      return;
    }
    setPermission(Notification.permission);
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
    });
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      if (!("serviceWorker" in navigator)) throw new Error("No service worker support");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setError("Notification permission was denied");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
      const json = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      await savePushSubscription({
        endpoint: json.endpoint ?? sub.endpoint,
        p256dh: json.keys?.p256dh ?? bufferToBase64Url(sub.getKey("p256dh")),
        auth: json.keys?.auth ?? bufferToBase64Url(sub.getKey("auth")),
        userAgent: navigator.userAgent,
      });
      setSubscribed(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <p className="text-sm text-zinc-600">
        Notifications aren&apos;t supported in this browser.
      </p>
    );
  }

  if (permission === "denied") {
    return (
      <p className="text-sm text-amber-800">
        Notifications are blocked. Re-enable them for this site in your browser
        settings, then come back.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {subscribed ? (
        <button
          type="button"
          onClick={disable}
          disabled={busy}
          className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50"
        >
          {busy ? "Working…" : "Disable notifications"}
        </button>
      ) : (
        <button
          type="button"
          onClick={enable}
          disabled={busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-brand-600 px-4 text-sm font-bold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "Working…" : "Enable notifications"}
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {subscribed && (
        <p className="text-xs text-zinc-500">
          On this device. Enable separately on each phone/computer.
        </p>
      )}
    </div>
  );
}
