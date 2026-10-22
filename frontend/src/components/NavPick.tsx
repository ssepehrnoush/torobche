import { useState } from "react";
import { Sheet } from "./Sheet";
import { Choice } from "./wizard/Shell";

export type NavLinks = { neshan: string; balad: string; google: string };
type NavApp = keyof NavLinks;

const APPS: { k: NavApp; name: string; sub: string }[] = [
  { k: "neshan", name: "نشان", sub: "مسیر با ماشین، مترو یا پیاده" },
  { k: "balad", name: "بلد", sub: "مسیر با ترافیک لحظه‌ای" },
  { k: "google", name: "گوگل‌مپ", sub: "اگر روی گوشیت نصبه" },
];
const KEY = "bazargard.navApp";

function saved(): NavApp | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "neshan" || v === "balad" || v === "google" ? v : null;
  } catch {
    return null;
  }
}

function save(k: NavApp) {
  try {
    localStorage.setItem(KEY, k);
  } catch {
    /* private mode: ask again next time */
  }
}

/** Routing opens in the person's own map app: Neshan, Balad or Google Maps is asked once, then remembered.
    `open(nav)` goes straight to the remembered app; `open(nav, true)` asks again (to change it). */
export function useNavPick() {
  const [links, setLinks] = useState<NavLinks | null>(null);
  const [app, setApp] = useState<NavApp | null>(saved);
  const [keep, setKeep] = useState(true);

  const open = (nav: NavLinks, ask = false) => {
    const a = ask ? null : saved();
    if (a) window.open(nav[a], "_blank", "noopener");
    else setLinks(nav);
  };
  const pick = (k: NavApp) => {
    if (!links) return;
    if (keep) {
      save(k);
      setApp(k);
    }
    window.open(links[k], "_blank", "noopener");
    setLinks(null);
  };

  const sheet = links && (
    <Sheet title="با کدوم برنامه مسیریابی کنم؟" onClose={() => setLinks(null)}>
      <div className="wz-opts">
        {APPS.map((a) => <Choice key={a.k} on={app === a.k} onClick={() => pick(a.k)} title={a.name} sub={a.sub} />)}
      </div>
      <label className="navkeep">
        <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> دفعهٔ بعد نپرس، همین رو باز کن
      </label>
    </Sheet>
  );
  return { open, sheet, appName: APPS.find((a) => a.k === app)?.name ?? null };
}
