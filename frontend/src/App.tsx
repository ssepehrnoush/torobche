import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { get, stream } from "./api";
import { CompareSheet, ProductSheet } from "./components/Products";
import { AboutSheet } from "./components/AboutSheet";
import { ctxChanges, FiltersButton, FiltersSheet, PlaceChip, RouteSheet } from "./components/ContextBar";
import { DesktopAside } from "./components/DesktopAside";
import { RadishLogo } from "./components/Logo";
import { AgentBlock, Feed, Home, type FeedHandlers } from "./components/Feed";
import { InquiryView, type InquiryState } from "./components/InquiryView";
import { ShopSheet } from "./components/ShopSheet";
import { ShopsView } from "./components/ShopsView";
import { VisitView } from "./components/VisitView";
import { fa } from "./fmt";
import { Icon } from "./icons";
import type { Authenticity, Bargain, Ctx, FeedItem, Meta, ProductCard } from "./types";

type Step = "discover" | "shops" | "inquiry" | "visit";
type AgentItem = Extract<FeedItem, { kind: "agent" }>;
type SheetState = null | { kind: "shop"; sid: number; auth?: Authenticity } | { kind: "product"; pid: number } | { kind: "compare" } | { kind: "about" } | { kind: "route" } | { kind: "filters" };

const DEFAULT_CTX: Ctx = {
  lat: 35.6998, lon: 51.4197, place: "میدان فردوسی", radius_km: 5, budget_min: null, budget_max: null,
  visit: "now", installments_only: false, torob_pay_only: false, open_only: false,
  range_mode: "time", range_minutes: 20, travel_mode: "car", originality: "any",
};
const STEPS: { key: Step; label: string }[] = [
  { key: "discover", label: "انتخاب کالا" },
  { key: "shops", label: "فروشگاه‌ها" },
  { key: "inquiry", label: "استعلام" },
  { key: "visit", label: "مراجعه" },
];
const PLACEHOLDER: Record<Step, string> = {
  discover: "جواب بده یا چیز دیگه‌ای بپرس…",
  shops: "مثلاً: فقط قسطی‌ها رو نشون بده",
  inquiry: "سؤالی دربارهٔ این فروشگاه‌ها دارید؟",
  visit: "مثلاً: فردا صبح می‌رم، دوباره بچین",
};
/* Web Speech API error codes, each with what the person can actually do about it. */
const VOICE_ERROR: Record<string, string> = {
  "not-allowed": "اجازهٔ میکروفون داده نشده؛ از تنظیمات مرورگر اجازه بدهید یا تایپ کنید",
  "service-not-allowed": "مرورگر شما اجازهٔ تشخیص صدا نمی‌دهد؛ لطفاً تایپ کنید",
  "network": "سرویس تشخیص صدای مرورگر در دسترس نیست؛ لطفاً تایپ کنید",
  "language-not-supported": "مرورگر شما تشخیص صدای فارسی ندارد؛ لطفاً تایپ کنید",
  "no-speech": "صدایی نشنیدم؛ دوباره میکروفون را بزنید و حرف بزنید",
  "audio-capture": "میکروفونی پیدا نشد؛ لطفاً تایپ کنید",
};

function loadCtx(): Ctx {
  try {
    const raw = localStorage.getItem("bazargard.ctx");
    if (raw) return { ...DEFAULT_CTX, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_CTX;
}

let seq = 0;
const nid = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;

/** iOS Safari ignores interactive-widget, so lift the bottom bar by the keyboard height it reports. */
function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--kb", `${Math.round(kb)}px`);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [ctx, setCtxState] = useState<Ctx>(loadCtx);
  const [step, setStep] = useState<Step>("discover");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [pid, setPid] = useState<number | null>(null);
  const [shopPicks, setShopPicks] = useState<{ sid: number; why: string }[]>([]);
  const [shopMsg, setShopMsg] = useState<string | null>(null);
  const [shopFocus, setShopFocus] = useState<number | null>(null);
  const [compare, setCompare] = useState<number[]>([]);
  const [inq, setInq] = useState<InquiryState | null>(null);
  const [visit, setVisit] = useState<{ pid: number | null; sids: number[]; confirmed: Record<number, unknown> | null } | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [input, setInput] = useState("");
  const session = useRef<string | null>(null);
  const ctxRef = useRef<Ctx>(ctx);
  const [productsKey, setProductsKey] = useState<string | null>(null);
  const firstNeed = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // was the reader at the bottom of the chat the last time they scrolled?
  const settled = useRef<Set<string>>(new Set());
  const demo = new URLSearchParams(window.location.search).has("demo");
  const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const speech = !!SR;
  const [listening, setListening] = useState(false);
  useKeyboardInset();

  const listen = () => {
    if (!SR || listening) return;
    const rec = new SR();
    rec.lang = "fa-IR";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      const t = e.results?.[0]?.[0]?.transcript as string | undefined;
      if (t) send(t);
    };
    rec.onerror = (e: any) => {
      if (e?.error === "aborted") return; // stopped on purpose, nothing to say
      toast(VOICE_ERROR[e?.error] ?? "صدا تشخیص داده نشد؛ لطفاً تایپ کنید");
    };
    rec.onend = () => setListening(false);
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      toast("تشخیص صدا شروع نشد؛ لطفاً تایپ کنید");
    }
  };

  useEffect(() => {
    get<Meta>("/api/meta").then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    const onScroll = () => {
      stick.current = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) < 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Follow the answer while it streams; when it lands, show its top if it is taller than the screen.
  useLayoutEffect(() => {
    if (step !== "discover") return;
    const last = [...feed].reverse().find((f) => f.kind === "agent") as AgentItem | undefined;
    if (!last) return;
    if (last.pending) {
      if (stick.current) endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
      return;
    }
    if (settled.current.has(last.id)) return;
    settled.current.add(last.id);
    if (!stick.current) return;
    const el = document.querySelector(`.agent[data-id="${last.id}"]`) as HTMLElement | null;
    if (!el) return;
    const room = window.innerHeight - 190; // sticky header above, composer below
    if (el.offsetHeight > room) el.scrollIntoView({ block: "start", behavior: "smooth" });
    else endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [feed, step]);

  const setCtx = useCallback((c: Ctx) => {
    ctxRef.current = c;
    setCtxState(c);
    try {
      localStorage.setItem("bazargard.ctx", JSON.stringify(c));
    } catch {
      /* ignore */
    }
  }, []);

  const toast = useCallback((s: string) => {
    setToastMsg(s);
    window.setTimeout(() => setToastMsg(null), 2800);
  }, []);

  const go = (s: Step) => {
    setStep(s);
    setOverlay(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openShops = (p: number, picks: { sid: number; why: string }[] = [], msg: string | null = null, focus: number | null = null) => {
    setPid(p);
    setShopPicks(picks);
    setShopMsg(msg);
    setShopFocus(focus);
    setSheet(null);
    go("shops");
  };
  const startInquiry = (p: number, sids: number[]) => {
    setInq({ pid: p, sids, started: false, shops: [], replies: {}, summary: null, callScript: [], notice: "", product: null });
    setSheet(null);
    go("inquiry");
  };
  const startVisit = (p: number | null, sids: number[], confirmed: Record<number, unknown> | null) => {
    setVisit({ pid: p, sids, confirmed });
    setSheet(null);
    go("visit");
  };

  const prefKey = (c: Ctx) => [c.lat, c.lon, c.range_mode, c.range_minutes, c.radius_km, c.travel_mode, c.budget_min, c.budget_max, c.installments_only, c.originality].join("|");

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    if (!firstNeed.current) firstNeed.current = text;
    setInput("");
    setAskOpen(false);
    (document.activeElement as HTMLElement | null)?.blur?.();
    const aid = nid();
    const uid = nid();
    const t0 = performance.now();
    const before = ctxRef.current;
    stick.current = true;
    setFeed((f) => [...f, { kind: "user", id: uid, text }, { kind: "agent", id: aid, steps: [], pending: true }]);
    if (step !== "discover") setOverlay(aid);
    setBusy(true);
    const patch = (fn: (a: AgentItem) => AgentItem) =>
      setFeed((f) => f.map((x) => (x.id === aid && x.kind === "agent" ? fn(x) : x)));
    try {
      await stream("/api/chat", { session_id: session.current, text, ctx: ctxRef.current, ui: { step, pid, compare } }, (ev) => {
        if (ev.bargain && ["ask", "products", "message", "shops"].includes(ev.type)) patch((a) => ({ ...a, bargain: ev.bargain }));
        switch (ev.type) {
          case "session":
            session.current = ev.session_id;
            break;
          case "status":
            patch((a) => ({ ...a, status: ev.text }));
            break;
          case "step_start":
            patch((a) => ({ ...a, steps: [...a.steps, { id: ev.id, tool: ev.tool, label: ev.label, done: false }] }));
            break;
          case "step":
            patch((a) => {
              const id = ev.id ?? nid();
              const exists = a.steps.some((s) => s.id === id);
              const s = { id, tool: ev.tool, label: ev.label, detail: ev.detail, done: true };
              return { ...a, steps: exists ? a.steps.map((x) => (x.id === id ? s : x)) : [...a.steps, s] };
            });
            break;
          case "ctx":
            setCtx({ ...DEFAULT_CTX, ...ev.ctx });
            patch((a) => ({ ...a, applied: ctxChanges(before, { ...DEFAULT_CTX, ...ev.ctx }, meta) }));
            break;
          case "ask":
            patch((a) => ({ ...a, message: ev.message, ask: ev.questions }));
            break;
          case "products":
            patch((a) => ({ ...a, message: ev.message, products: ev.items, suggestions: ev.suggestions, notice: ev.notice }));
            setProductsKey(prefKey(ctxRef.current));
            if (step !== "discover") go("discover");
            break;
          case "shops":
            patch((a) => ({ ...a, message: ev.message, shopsPid: ev.pid, suggestions: ev.suggestions }));
            openShops(ev.pid, ev.picks ?? [], ev.message);
            setOverlay(null);
            break;
          case "inquiry":
            patch((a) => ({ ...a, message: ev.message, inquiry: { pid: ev.pid, sids: ev.sids } }));
            startInquiry(ev.pid, ev.sids);
            setOverlay(null);
            break;
          case "message":
            patch((a) => ({ ...a, message: ev.text, suggestions: ev.suggestions }));
            break;
          case "error":
            patch((a) => ({ ...a, error: ev.text }));
            break;
        }
      });
    } catch {
      patch((a) => ({ ...a, error: "ارتباط با سرور برقرار نشد؛ دوباره امتحان کنید." }));
    }
    patch((a) => ({ ...a, pending: false, elapsed: (performance.now() - t0) / 1000 }));
    setBusy(false);
  };

  const reset = () => {
    if (busy) return;
    session.current = null;
    firstNeed.current = null;
    settled.current.clear();
    setFeed([]);
    setCompare([]);
    setPid(null);
    setShopPicks([]);
    setShopMsg(null);
    setShopFocus(null);
    setInq(null);
    setVisit(null);
    setSheet(null);
    setProductsKey(null);
    setCtx(DEFAULT_CTX);
    go("discover");
    toast("از اول شروع کنیم");
  };

  const toggleCompare = (p: number) => {
    setCompare((c) => {
      if (c.includes(p)) return c.filter((x) => x !== p);
      if (c.length >= 3) {
        toast("حداکثر ۳ کالا را می‌شود مقایسه کرد");
        return c;
      }
      return [...c, p];
    });
  };

  const started = feed.length > 0 || pid != null;
  const reachable: Record<Step, boolean> = { discover: true, shops: pid != null, inquiry: inq != null, visit: visit != null };
  const overlayItem = overlay ? (feed.find((f) => f.id === overlay) as AgentItem | undefined) : undefined;
  const handlers: FeedHandlers = {
    ctx,
    compare,
    busy,
    onSend: send,
    onShops: (p: ProductCard) => openShops(p.pid),
    onCompare: toggleCompare,
    onAnswered: (id: string) => setFeed((f) => f.map((x) => (x.id === id && x.kind === "agent" ? { ...x, answered: true } : x))),
    onOpenShops: (p: number) => openShops(p, shopPicks, shopMsg),
    onOpenInquiry: () => go("inquiry"),
    onBargain: (b: Bargain) => {
      const target = b.pid ?? pid;
      if (target != null) openShops(target, shopPicks, shopMsg, b.sid);
    },
    onEditFilters: () => setSheet({ kind: "filters" }),
  };
  const stepIdx = STEPS.findIndex((x) => x.key === step);
  const openShop = (sid: number, offer?: { authenticity?: Authenticity }) => setSheet({ kind: "shop", sid, auth: offer?.authenticity });

  return (
    <div className={"app" + (started ? " started" : "")}>
      <DesktopAside />
      <header className="top">
        <div className="bar">
          <div className="wordmark" aria-label="تربچه، خرید حضوری">
            <RadishLogo size={28} />
            <b>تربچه</b>
            <i className="sep" />
            <span>خرید حضوری</span>
          </div>
          <div className="spacer" />
          <PlaceChip ctx={ctx} onOpen={() => setSheet({ kind: "route" })} />
          <FiltersButton ctx={ctx} onOpen={() => setSheet({ kind: "filters" })} />
          <button className="iconbtn" onClick={() => setSheet({ kind: "about" })} aria-label="دربارهٔ داده و روش کار">
            <Icon name="info" size={21} />
          </button>
        </div>
        {started && (
          <nav className="journey" aria-label="مراحل خرید">
            {STEPS.map((s, i) => (
              <button key={s.key} className={"jstep" + (s.key === step ? " active" : i < stepIdx ? " done" : "")} disabled={!reachable[s.key]}
                aria-current={s.key === step ? "step" : undefined} onClick={() => go(s.key)}>
                {s.label}
              </button>
            ))}
            <button className="jreset" onClick={reset} disabled={busy} aria-label="شروع دوباره"><Icon name="refresh" size={18} /></button>
          </nav>
        )}
      </header>

      <main>
        {step === "discover" && (
          <>
            {feed.length === 0 ? <Home meta={meta} busy={busy} onSend={send} /> : (
              <Feed items={feed} {...handlers}
                stale={!busy && productsKey != null && productsKey !== prefKey(ctx)}
                onRefresh={() => send("ترجیحاتم را عوض کردم؛ با شرایط جدید دوباره پیشنهاد بده")} />
            )}
            <div ref={endRef} className="endref" />
          </>
        )}
        {step === "shops" && pid != null && (
          <ShopsView
            key={pid}
            pid={pid}
            ctx={ctx}
            setCtx={setCtx}
            picks={shopPicks}
            agentMsg={shopMsg}
            focus={shopFocus}
            onOpenShop={openShop}
            onInquiry={(sids) => startInquiry(pid, sids)}
            onVisit={(sids) => startVisit(pid, sids, null)}
            onProduct={(p) => openShops(p.pid)}
            onDetails={() => setSheet({ kind: "product", pid })}
          />
        )}
        {step === "inquiry" && inq && (
          <InquiryView
            key={`${inq.pid}:${inq.sids.join(",")}`}
            st={inq}
            setSt={(f) => setInq((s) => (s ? f(s) : s))}
            ctx={ctx}
            demo={demo}
            toast={toast}
            onOpenShop={openShop}
            onVisit={(sids, confirmed) => startVisit(inq.pid, sids, confirmed)}
            onRestart={(sids) => startInquiry(inq.pid, sids)}
            onProduct={(p) => openShops(p.pid)}
          />
        )}
        {step === "visit" && visit && (
          <VisitView pid={visit.pid} sids={visit.sids} confirmed={visit.confirmed} ctx={ctx} toast={toast} onOpenShop={(sid) => openShop(sid)} />
        )}
      </main>

      {step === "discover" && compare.length > 0 && (
        <div className="comparebar">
          <Icon name="compare" size={18} />
          <span className="grow">{fa(compare.length)} کالا برای مقایسه</span>
          <button className="textbtn light" onClick={() => setCompare([])}>پاک کردن</button>
          <button className="btn sm" disabled={compare.length < 2} onClick={() => setSheet({ kind: "compare" })}>مقایسه کن</button>
        </div>
      )}

      {step === "discover" ? (
        <div className="composer">
          <form onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} enterKeyHint="send" aria-label="پیام به دستیار"
              placeholder={listening ? "در حال شنیدن…" : feed.length ? PLACEHOLDER.discover : "اسم کالا یا نیازت رو بنویس…"} />
            {speech && (
              <button type="button" className={"micbtn" + (listening ? " rec" : "")} onClick={listen} disabled={busy} aria-label="گفتن با صدا"><Icon name="mic" size={20} /></button>
            )}
            <button className="sendbtn" type="submit" disabled={busy || !input.trim()} aria-label="ارسال"><Icon name="up" size={20} stroke={2} /></button>
          </form>
        </div>
      ) : (
        <>
          {!askOpen && !overlayItem && (
            <button className="fab" onClick={() => setAskOpen(true)} aria-label="از دستیار بپرس">
              <Icon name="spark" size={20} stroke={1.8} /> بپرس
            </button>
          )}
          {overlayItem && (
            <>
              <div className="backdrop light" onClick={() => setOverlay(null)} />
              <div className="sheet answer" role="dialog" aria-label="پاسخ دستیار">
                <div className="sheethead">
                  <span className="grab" />
                  <h2>دستیار ترب</h2>
                  <button className="iconbtn" onClick={() => setOverlay(null)} aria-label="بستن"><Icon name="x" size={20} /></button>
                </div>
                <div className="sheetbody"><AgentBlock it={overlayItem} {...handlers} /></div>
              </div>
            </>
          )}
          {askOpen && (
            <>
              <div className="backdrop light" onClick={() => setAskOpen(false)} />
              <div className="composer floating">
                <form onSubmit={(e) => { e.preventDefault(); send(input); }}>
                  <input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder={PLACEHOLDER[step]} enterKeyHint="send" aria-label="پیام به دستیار" />
                  <button type="button" className="micbtn" onClick={() => setAskOpen(false)} aria-label="بستن"><Icon name="x" size={20} /></button>
                  <button className="sendbtn" type="submit" disabled={busy || !input.trim()} aria-label="ارسال"><Icon name="up" size={20} stroke={2} /></button>
                </form>
              </div>
            </>
          )}
        </>
      )}

      {sheet?.kind === "route" && <RouteSheet ctx={ctx} setCtx={setCtx} meta={meta} toast={toast} onClose={() => setSheet(null)} />}
      {sheet?.kind === "filters" && <FiltersSheet ctx={ctx} setCtx={setCtx} meta={meta} onClose={() => setSheet(null)} />}
      {sheet?.kind === "shop" && (
        <ShopSheet sid={sheet.sid} auth={sheet.auth} pid={step === "visit" ? visit?.pid ?? pid : step === "inquiry" ? inq?.pid ?? pid : pid} ctx={ctx}
          onClose={() => setSheet(null)}
          onInquiry={(sid) => pid != null && startInquiry(inq?.pid ?? pid, [sid])}
          onVisit={(sid) => startVisit(pid, [sid], null)}
          onOpenShop={(sid) => openShop(sid)} />
      )}
      {sheet?.kind === "product" && (
        <ProductSheet pid={sheet.pid} ctx={ctx} onClose={() => setSheet(null)} onShops={() => openShops(sheet.pid)} />
      )}
      {sheet?.kind === "compare" && (
        <CompareSheet pids={compare} ctx={ctx} need={firstNeed.current} onClose={() => setSheet(null)}
          onShops={(p) => openShops(p)} onRemove={(p) => setCompare((c) => c.filter((x) => x !== p))} />
      )}
      {sheet?.kind === "about" && <AboutSheet meta={meta} onClose={() => setSheet(null)} onRestart={started ? () => { setSheet(null); reset(); } : undefined} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
