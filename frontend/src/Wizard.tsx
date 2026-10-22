import { useCallback, useEffect, useRef, useState } from "react";
import { get, stream } from "./api";
import { AboutSheet } from "./components/AboutSheet";
import { FiltersSheet } from "./components/ContextBar";
import { DesktopAside } from "./components/DesktopAside";
import type { InquiryState } from "./components/InquiryView";
import { RadishLogo } from "./components/Logo";
import { ProductSheet } from "./components/Products";
import { ShopSheet } from "./components/ShopSheet";
import { GoStep } from "./components/wizard/GoStep";
import { InquiryStep } from "./components/wizard/InquiryStep";
import { PickStep } from "./components/wizard/PickStep";
import { Progress } from "./components/wizard/Shell";
import { ShopsStep } from "./components/wizard/ShopsStep";
import { HowStep, NeedStep, WhereStep } from "./components/wizard/StartSteps";
import { Icon } from "./icons";
import type { Authenticity, Ctx, FeedItem, Meta } from "./types";
import "./wizard.css";

/* The same journey as the chat UI, as a setup wizard: one question per screen, «قبلی» and one main button. */
type Step = "need" | "where" | "how" | "pick" | "shops" | "ask" | "go";
const ORDER: Step[] = ["need", "where", "how", "pick", "shops", "ask", "go"];
type AgentItem = Extract<FeedItem, { kind: "agent" }>;
type SheetState = null | { kind: "shop"; sid: number; auth?: Authenticity } | { kind: "product"; pid: number } | { kind: "about" } | { kind: "filters" };

const DEFAULT_CTX: Ctx = {
  lat: 35.6998, lon: 51.4197, place: "میدان فردوسی", radius_km: 5, budget_min: null, budget_max: null,
  visit: "now", installments_only: false, torob_pay_only: false, open_only: false,
  range_mode: "time", range_minutes: 20, travel_mode: "car", originality: "any",
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
const nid = () => `w${Date.now().toString(36)}${(seq++).toString(36)}`;
/* Budget, installments and the like belong to one search: a new need starts without them, the trip settings stay. */
const NO_FILTERS: Partial<Ctx> = { visit: "now", budget_min: null, budget_max: null, installments_only: false, torob_pay_only: false, open_only: false, originality: "any" };
const prefKey = (c: Ctx) => [c.lat, c.lon, c.range_mode, c.range_minutes, c.radius_km, c.travel_mode, c.budget_min, c.budget_max, c.installments_only, c.originality].join("|");

export default function Wizard() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [ctx, setCtxState] = useState<Ctx>(loadCtx);
  const [step, setStep] = useState<Step>("need");
  const [need, setNeed] = useState("");
  const [turn, setTurn] = useState<AgentItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [pid, setPid] = useState<number | null>(null);
  const [picks, setPicks] = useState<{ sid: number; why: string }[]>([]);
  const [inq, setInq] = useState<InquiryState | null>(null);
  const [visit, setVisit] = useState<{ pid: number | null; sids: number[]; confirmed: Record<number, unknown> | null; asked: boolean } | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false); // no shopping place is assumed: the person picks one every time
  const lastPick = useRef<"here" | "there" | null>(null);
  const session = useRef<string | null>(null);
  const ctxRef = useRef<Ctx>(ctx);
  const searched = useRef<string | null>(null); // need + preferences of the last search, to skip re-asking on «قبلی/ادامه»
  const lastNeed = useRef<string | null>(null);
  const demo = new URLSearchParams(window.location.search).has("demo");

  useEffect(() => {
    get<Meta>("/api/meta").then(setMeta).catch(() => {});
  }, []);

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

  // Near me usually means a drive or a ride; a place picked on the map usually means walking around there.
  // The travel default changes only when the kind of pick changes, so a choice made in the next step survives.
  const pickPlace = (p: { lat: number; lon: number; label: string }, how: "here" | "there") => {
    const c = { ...ctxRef.current, lat: p.lat, lon: p.lon, place: p.label };
    if (lastPick.current !== how) Object.assign(c, how === "here" ? { travel_mode: "car", range_mode: "time", range_minutes: 20 } : { travel_mode: "walk", range_mode: "time", range_minutes: 20 });
    lastPick.current = how;
    setPlaced(true);
    setCtx(c);
  };

  const go = (s: Step) => {
    setStep(s);
    setSheet(null);
    window.scrollTo({ top: 0 });
  };

  const openShops = (p: number, ps: { sid: number; why: string }[] = []) => {
    setPid(p);
    setPicks(ps);
    go("shops");
  };
  const startInquiry = (p: number, sids: number[]) => {
    setInq({ pid: p, sids, started: false, shops: [], replies: {}, summary: null, callScript: [], notice: "", product: null });
    go("ask");
  };
  const startVisit = (p: number | null, sids: number[], confirmed: Record<number, unknown> | null, asked: boolean) => {
    setVisit({ pid: p, sids, confirmed, asked });
    go("go");
  };

  const send = async (text: string, fresh = false) => {
    if (!text || busy) return;
    if (fresh) session.current = null;
    const id = nid();
    setTurn({ kind: "agent", id, steps: [], pending: true });
    setBusy(true);
    const patch = (fn: (a: AgentItem) => AgentItem) => setTurn((a) => (a && a.id === id ? fn(a) : a));
    try {
      await stream("/api/chat", { session_id: session.current, text, ctx: ctxRef.current, ui: { step: "discover", pid, compare: [] } }, (ev) => {
        switch (ev.type) {
          case "session":
            session.current = ev.session_id;
            break;
          case "status":
            patch((a) => ({ ...a, status: ev.text }));
            break;
          case "step_start":
            patch((a) => ({ ...a, status: ev.label }));
            break;
          case "ctx":
            setCtx({ ...DEFAULT_CTX, ...ev.ctx });
            break;
          case "ask":
            patch((a) => ({ ...a, message: ev.message, ask: ev.questions }));
            break;
          case "products":
            patch((a) => ({ ...a, message: ev.message, products: ev.items, notice: ev.notice, suggestions: ev.suggestions }));
            break;
          case "shops":
            patch((a) => ({ ...a, message: ev.message, shopsPid: ev.pid }));
            openShops(ev.pid, ev.picks ?? []);
            break;
          case "inquiry":
            startInquiry(ev.pid, ev.sids);
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
    patch((a) => ({ ...a, pending: false }));
    setBusy(false);
  };

  // «پیدا کن»: search again only if the need or the trip changed since the last search.
  const search = () => {
    const key = `${need.trim()}|${prefKey(ctxRef.current)}`;
    if (searched.current !== key || !turn) {
      searched.current = key;
      send(need.trim(), true);
    }
    go("pick");
  };

  const reset = () => {
    if (busy) return;
    session.current = null;
    searched.current = null;
    lastNeed.current = null;
    lastPick.current = null;
    setPlaced(false);
    setCtx({ ...ctxRef.current, ...NO_FILTERS });
    setNeed("");
    setTurn(null);
    setPid(null);
    setPicks([]);
    setInq(null);
    setVisit(null);
    go("need");
  };

  const back: Record<Step, Step> = {
    need: "need",
    where: "need",
    how: "where",
    pick: "how",
    shops: turn?.products?.length ? "pick" : "how",
    ask: pid != null ? "shops" : "pick",
    go: visit?.asked && inq ? "ask" : pid != null ? "shops" : "pick",
  };
  const goBack = () => go(back[step]);
  const openShop = (sid: number, auth?: Authenticity) => setSheet({ kind: "shop", sid, auth });
  const sheetPid = step === "go" ? visit?.pid ?? pid : step === "ask" ? inq?.pid ?? pid : pid;

  return (
    <div className="app wz">
      <DesktopAside />
      <header className="top">
        <div className="bar">
          <div className="wordmark" aria-label="ترب، خرید حضوری">
            <RadishLogo size={28} />
            <b>ترب</b>
            <i className="sep" />
            <span>خرید حضوری</span>
          </div>
          <div className="spacer" />
          {step !== "need" && (
            <button className="textbtn muted wz-restart" onClick={reset} disabled={busy}><Icon name="refresh" size={16} /> از اول</button>
          )}
          <button className="iconbtn" onClick={() => setSheet({ kind: "about" })} aria-label="دربارهٔ داده و روش کار">
            <Icon name="info" size={21} />
          </button>
        </div>
        <Progress idx={ORDER.indexOf(step)} n={ORDER.length} />
      </header>

      <main className="wz-main" key={step}>
        {step === "need" && <NeedStep need={need} setNeed={setNeed} meta={meta}
          onNext={(t) => {
            const text = (t ?? need).trim();
            if (t) setNeed(t);
            if (text !== lastNeed.current) setCtx({ ...ctxRef.current, ...NO_FILTERS });
            lastNeed.current = text;
            go("where");
          }} />}
        {step === "where" && <WhereStep ctx={ctx} placed={placed} pickPlace={pickPlace} toast={toast} onBack={goBack} onNext={() => go("how")} />}
        {step === "how" && <HowStep ctx={ctx} setCtx={setCtx} onFilters={() => setSheet({ kind: "filters" })} onBack={goBack} onNext={search} />}
        {step === "pick" && (
          <PickStep turn={turn} busy={busy} onBack={goBack} onSend={(t) => send(t)} onPick={(p) => openShops(p)}
            onRetry={() => { searched.current = null; search(); }} />
        )}
        {step === "shops" && pid != null && (
          <ShopsStep key={pid} pid={pid} ctx={ctx} setCtx={setCtx} picks={picks} onBack={goBack} onOpenShop={openShop}
            onAsk={(sids) => startInquiry(pid, sids)} onGo={(sids) => startVisit(pid, sids, null, false)}
            onDetails={() => setSheet({ kind: "product", pid })} />
        )}
        {step === "ask" && inq && (
          <InquiryStep key={`${inq.pid}:${inq.sids.join(",")}`} st={inq} setSt={(f) => setInq((s) => (s ? f(s) : s))} ctx={ctx} demo={demo} toast={toast}
            onBack={goBack} onOpenShop={(sid) => openShop(sid)}
            onGo={(sids, confirmed) => startVisit(inq.pid, sids, confirmed, true)} onRestart={(sids) => startInquiry(inq.pid, sids)} />
        )}
        {step === "go" && visit && (
          <GoStep pid={visit.pid} sids={visit.sids} confirmed={visit.confirmed} ctx={ctx} toast={toast} onBack={goBack} onOpenShop={(sid) => openShop(sid)} />
        )}
      </main>

      {sheet?.kind === "filters" && <FiltersSheet ctx={ctx} setCtx={setCtx} meta={meta} onClose={() => setSheet(null)} />}
      {sheet?.kind === "shop" && (
        <ShopSheet sid={sheet.sid} auth={sheet.auth} pid={sheetPid} ctx={ctx} onClose={() => setSheet(null)}
          onInquiry={(sid) => sheetPid != null && startInquiry(sheetPid, [sid])}
          onVisit={(sid) => startVisit(sheetPid, [sid], null, false)}
          onOpenShop={(sid) => openShop(sid)} />
      )}
      {sheet?.kind === "product" && <ProductSheet pid={sheet.pid} ctx={ctx} onClose={() => setSheet(null)} onShops={() => setSheet(null)} />}
      {sheet?.kind === "about" && <AboutSheet meta={meta} onClose={() => setSheet(null)} onRestart={step !== "need" ? () => { setSheet(null); reset(); } : undefined} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
