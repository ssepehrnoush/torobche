import { useEffect, useState } from "react";
import { fa } from "./fmt";

/** The current time, refreshed every `ms` while the component is on screen (for countdowns). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/** «۱:۵۸:۱۲» left until `iso`, or null once it has passed. */
export function left(iso: string, now: number): string | null {
  const s = Math.floor((new Date(iso).getTime() - now) / 1000);
  if (s <= 0) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return fa(`${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`);
}
