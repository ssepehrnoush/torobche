import { fa } from "./fmt";

/* Tell the person a shop answered while they are in another app (the text app, the map app): a system
   notification through a service worker (Android Chrome has no page-level Notification), a short
   vibration, and a count in the tab title until they come back. */
let reg: ServiceWorkerRegistration | null = null;
const baseTitle = document.title;
let unseen = 0;

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    unseen = 0;
    document.title = baseTitle;
  }
});

/** Call from a tap (the browser only asks for permission on one). Refusal or no support is fine. */
export async function askToNotify(): Promise<void> {
  try {
    const perm = "Notification" in window && Notification.permission === "default" ? Notification.requestPermission() : null;
    if ("serviceWorker" in navigator) reg = await navigator.serviceWorker.register("/sw.js");
    await perm;
  } catch {
    /* not supported or refused: the page itself still updates */
  }
}

export function notify(title: string, body: string): void {
  try {
    navigator.vibrate?.([80, 40, 80]);
  } catch {
    /* no vibration */
  }
  if (!document.hidden) return;
  unseen++;
  document.title = `(${fa(unseen)}) جواب رسید · ${baseTitle}`;
  if (reg && "Notification" in window && Notification.permission === "granted") {
    reg.showNotification(title, { body, tag: `torobche-${unseen}`, icon: "/favicon.svg", lang: "fa", dir: "rtl" }).catch(() => {});
  }
}
