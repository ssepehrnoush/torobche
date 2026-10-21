import type { Ctx } from "./types";

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json() as Promise<T>;
}

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json() as Promise<T>;
}

/** POST that answers with a text/event-stream; calls onEvent for every `data:` JSON line. */
export async function stream(path: string, body: unknown, onEvent: (ev: any) => void, signal?: AbortSignal) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(`${path} ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data:")) {
          try {
            onEvent(JSON.parse(line.slice(5)));
          } catch {
            /* ignore malformed line */
          }
        }
      }
    }
  }
}

export const api = {
  shops: (pid: number, ctx: Ctx, sort: string, exclude: number[] = [], signal?: AbortSignal) =>
    post<import("./types").ShopsResult>("/api/shops", { pid, ctx, sort, exclude }, signal),
  insight: (pid: number, ctx: Ctx, signal?: AbortSignal) =>
    post<{ headline: string; body: string; pick_sid: number | null }>("/api/shops/insight", { pid, ctx }, signal),
  shop: (sid: number, pid: number | null, ctx: Ctx) => post<import("./types").ShopDetail>("/api/shop", { sid, pid, ctx }),
  product: (pid: number, ctx: Ctx) => post<any>("/api/product", { pid, ctx }),
  compare: (pids: number[], ctx: Ctx) => post<any>("/api/compare", { pids, ctx }),
  verdict: (pids: number[], ctx: Ctx, need: string | null) =>
    post<{ verdict: string | null; best_pid: number | null; labels: Record<string, string> }>("/api/compare/verdict", { pids, ctx, need }),
  draft: (pid: number, sids: number[], ctx: Ctx) => post<any>("/api/inquiry/draft", { pid, sids, ctx }),
  visit: (pid: number | null, sids: number[], ctx: Ctx, confirmed: Record<number, unknown> | null) =>
    post<import("./types").VisitPlan>("/api/visit", { pid, sids, ctx, confirmed }),
  stroll: (pid: number, sid: number, ctx: Ctx) => post<import("./types").Stroll>("/api/stroll", { pid, sid, ctx }),
  places: async (q: string, signal?: AbortSignal) => {
    const r = await fetch(`/api/places?q=${encodeURIComponent(q)}`, { signal });
    if (!r.ok) throw new Error(`/api/places ${r.status}`);
    return (await r.json()) as { items: import("./types").PlaceHit[] };
  },
};
