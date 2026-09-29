"use client";

import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type PushInfo = { configured: boolean; publicKey: string };

function vapidBytes(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export default function AdminPwaManager({ csrfToken }: { csrfToken: string }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(() => typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)));
  const [pushInfo, setPushInfo] = useState<PushInfo | null>(null);
  const [notifications, setNotifications] = useState<"checking" | "unsupported" | "blocked" | "off" | "on">("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [ios] = useState(() => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent));

  useEffect(() => {
    const rememberPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); };
    window.addEventListener("beforeinstallprompt", rememberPrompt);

    let active = true;
    void (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (active) setNotifications("unsupported");
        return;
      }
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const response = await fetch("/api/admin/push", { cache: "no-store" });
      if (!response.ok) throw new Error("Configuration indisponible");
      const info = await response.json() as PushInfo;
      if (!active) return;
      setPushInfo(info);
      setNotifications(Notification.permission === "denied" ? "blocked" : subscription ? "on" : "off");
    })().catch(() => { if (active) setNotifications("unsupported"); });

    return () => { active = false; window.removeEventListener("beforeinstallprompt", rememberPrompt); };
  }, []);

  async function install() {
    if (!installPrompt) {
      setMessage(ios ? "Sur iPhone : ouvrez Partager, puis « Sur l’écran d’accueil »." : "Ouvrez le menu du navigateur puis choisissez « Installer l’application »." );
      return;
    }
    await installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === "accepted") { setInstalled(true); setInstallPrompt(null); setMessage("Application installée."); }
  }

  async function enableNotifications() {
    if (!pushInfo?.configured || !pushInfo.publicKey) { setMessage("Ajoutez d’abord les clés de notification dans Railway."); return; }
    if (ios && !installed) { setMessage("Sur iPhone, installez d’abord l’application sur l’écran d’accueil, puis ouvrez-la."); return; }
    setBusy(true); setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setNotifications(permission === "denied" ? "blocked" : "off"); return; }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidBytes(pushInfo.publicKey),
      });
      const response = await fetch("/api/admin/push", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify(subscription.toJSON()),
      });
      const value = await response.json().catch(() => ({})) as { error?: string; warning?: string };
      if (!response.ok) throw new Error(value.error || "Activation impossible");
      setNotifications("on");
      setMessage(value.warning || "Notifications activées sur ce téléphone.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Activation impossible.");
    } finally { setBusy(false); }
  }

  return <div className="admin-pwa-tools">
    {!installed && <button type="button" onClick={install}>Installer l’application</button>}
    {notifications === "on" ? <span className="admin-push-on">● Notifications actives</span> :
      notifications === "blocked" ? <span className="admin-push-off">Notifications bloquées dans le navigateur</span> :
      notifications === "unsupported" ? <span className="admin-push-off">Notifications non disponibles</span> :
      <button type="button" disabled={busy || notifications === "checking"} onClick={enableNotifications}>{busy ? "Activation…" : "Activer les notifications"}</button>}
    {pushInfo && !pushInfo.configured && <span className="admin-push-off">Configuration Railway requise</span>}
    {message && <small role="status">{message}</small>}
  </div>;
}
