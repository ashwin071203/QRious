"use client";

import { api } from "@/lib/api";

/** Browser side of QRious web push: one service worker, one subscription per device, bound to the signed-in role. */
export type Role = "attendee" | "organizer";
const base = (role: Role) => (role === "attendee" ? "/me" : "/organizer");

export type PushSupport =
  | { state: "unsupported" }
  | { state: "ios_install" }      // iPhone/iPad Safari: add QRious to the Home Screen first (iOS 16.4+)
  | { state: "denied" }
  | { state: "available" }        // can be turned on
  | { state: "enabled" };         // this device receives pushes

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export async function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("/sw.js", { scope: "/" }); } catch { return null; }
}

export async function pushSupport(): Promise<PushSupport> {
  if (typeof window === "undefined") return { state: "unsupported" };
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!capable) return isIos() && !isStandalone() ? { state: "ios_install" } : { state: "unsupported" };
  if (Notification.permission === "denied") return { state: "denied" };
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? { state: "enabled" } : { state: "available" };
}

function urlBase64ToUint8Array(s: string) {
  const padding = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Asks for permission (must run from a user gesture), subscribes this device and registers it for the current account. */
export async function enablePush(role: Role) {
  const cfg = await api<{ enabled: boolean; publicKey: string | null }>("/push/config");
  if (!cfg.enabled || !cfg.publicKey) throw new Error("Push notifications aren't available yet.");
  const reg = await registerServiceWorker();
  if (!reg) throw new Error("This browser doesn't support push notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Notifications are blocked for QRious in your browser settings." : "Permission wasn't granted.");
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.publicKey) }));
  await api(`${base(role)}/push-subscriptions`, { method: "POST", body: sub.toJSON() });
}

/** Stops pushes to this device (server + browser). Used by the toggle and on sign-out (shared devices). */
export async function disablePush(role: Role) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api(`${base(role)}/push-subscriptions`, { method: "DELETE", body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** Re-registers an existing, permitted subscription for the signed-in session (e.g. after the session rotated). */
export async function refreshPush(role: Role) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("Notification" in window) || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await api(`${base(role)}/push-subscriptions`, { method: "POST", body: sub.toJSON() }).catch(() => {});
}
