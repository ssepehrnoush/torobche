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

/* Where the person is in the wizard survives a reload or the browser killing a background tab (they often
   leave for the text app or the map app mid-way), for as long as this tab lives. */
const SAVE_KEY = "torobche.wizard";
type Visit = { pid: number | null; sids: number[]; confirmed: Record<number, unknown> | null; asked: boolean };
type Saved = {
  step: Step; need: string; turn: AgentItem | null; pid: number | null; picks: { sid: number; why: string }[];
  inq: InquiryState | null; visit: Visit | null; placed: boolean; session: string | null; searched: string | null;
  lastNeed: string | null; lastPick: "here" | "there" | null;
};

function loadSaved(): Partial<Saved> {
  try {
    const s = JSON.parse(sessionStorage.getItem(SAVE_KEY) || "{}") as Partial<Saved>;
    if (s.turn?.pending) s.turn = null; // its answer never came; the pick step asks again
    return s.step && ORDER.includes(s.step) ? s : {};
  } catch {
    return {};
  }
}

/* Each step is an entry in the browser history, so the phone's back button goes one step back instead of
   leaving the site. `i` is the entry's place in this wizard's own stack; a sheet gets an entry of its own. */
type HistState = { wz: Step; i: number; sheet?: boolean };
const hist = (): HistState | null => {
  const s = window.history.state as HistState | null;
  return s && ORDER.includes(s.wz) ? s : null;
};

let seq = 0;
const nid = () => `w${Date.now().toString(36)}${(seq++).toString(36)}`;
/* Budget, installments and the like belong to one search: a new need starts without them, the trip settings stay. */
const NO_FILTERS: Partial<Ctx> = { visit: "now", budget_min: null, budget_max: null, installments_only: false, torob_pay_only: false, open_only: false, originality: "any" };
const prefKey = (c: Ctx) => [c.lat, c.lon, c.range_mode, c.range_minutes, c.radius_km, c.travel_mode, c.budget_min, c.budget_max, c.installments_only, c.originality].join("|");

export default function Wizard() {
  const [saved] = useState(loadSaved);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [ctx, setCtxState] = useState<Ctx>(loadCtx);
  const [step, setStep] = useState<Step>(saved.step ?? "need");
  const [need, setNeed] = useState(saved.need ?? "");
  const [turn, setTurn] = useState<AgentItem | null>(saved.turn ?? null);
  const [busy, setBusy] = useState(false);
  const [pid, setPid] = useState<number | null>(saved.pid ?? null);
  const [picks, setPicks] = useState<{ sid: number; why: string }[]>(saved.picks ?? []);
  const [inq, setInq] = useState<InquiryState | null>(saved.inq ?? null);
  const [visit, setVisit] = useState<Visit | null>(saved.visit ?? null);
  const [sheet, setSheetState] = useState<SheetState>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [placed, setPlaced] = useState(saved.placed ?? false); // no shopping place is assumed: the person picks one every time
  const lastPick = useRef<"here" | "there" | null>(saved.lastPick ?? null);
  const session = useRef<string | null>(saved.session ?? null);
  const ctxRef = useRef<Ctx>(ctx);
  const searched = useRef<string | null>(saved.searched ?? null); // need + preferences of the last search, to skip re-asking on «قبلی/ادامه»
  const lastNeed = useRef<string | null>(saved.lastNeed ?? null);
  const idx = useRef(0); // this entry's place in the wizard's history stack
  const resetting = useRef(false);
  const data = useRef({ pid, inq, visit, need });
  data.current = { pid, inq, visit, need };
  const demo = new URLSearchParams(window.location.search).has("demo");

  useEffect(() => {
    get<Meta>("/api/meta").then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const s: Saved = { step, need, turn, pid, picks, inq, visit, placed, session: session.current, searched: searched.current,
        lastNeed: lastNeed.current, lastPick: lastPick.current };
      sessionStorage.setItem(SAVE_KEY, JSON.stringify(s));
    } catch {
      /* storage full or blocked: the wizard still works, it just will not survive a reload */
    }
  }, [step, need, turn, pid, picks, inq, visit, placed]);

  // A step whose data is gone (an old history entry, a restored tab) shows the nearest earlier step that has it.
  const usable = (s: Step): Step => {
    const d = data.current;
    if (s === "go" && !d.visit) return usable(d.inq ? "ask" : "shops");
    if (s === "ask" && !d.inq) return usable("shops");
    if (s === "shops" && d.pid == null) return usable("pick");
    if (s === "pick" && !d.need.trim()) return "need";
    return s;
  };

  useEffect(() => {
    const h = hist();
    idx.current = h?.i ?? 0;
    window.history.replaceState({ wz: step, i: idx.current } satisfies HistState, "");
    const onPop = () => {
      const h = hist();
      if (!h) return;
      setSheetState(null);
      if (resetting.current) { // «از اول» unwound the stack to its first entry
        resetting.current = false;
        idx.current = 0;
        window.history.replaceState({ wz: "need", i: 0 } satisfies HistState, "");
        setStep("need");
        return;
      }
      idx.current = h.i;
      setStep(usable(h.wz));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []); // eslint-disable-line

  // Back on the pick step after a reload: the search that was running is gone, so run it again.
  useEffect(() => {
    if (step === "pick" && !turn && need.trim()) search();
  }, []); // eslint-disable-line

  const setSheet = (s: SheetState) => {
    if (s && !sheet) {
      idx.current++;
      window.history.pushState({ wz: step, i: idx.current, sheet: true } satisfies HistState, "");
    }
    if (!s && sheet && hist()?.sheet) window.history.back(); // the popstate closes it
    else setSheetState(s);
  };

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
    if (hist()?.sheet) window.history.replaceState({ wz: s, i: idx.current } satisfies HistState, ""); // the sheet's entry becomes the step
    else if (s !== step) {
      idx.current++;
      window.history.pushState({ wz: s, i: idx.current } satisfies HistState, "");
    }
    setSheetState(null);
    setStep(s);
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
    setSheetState(null);
    setStep("need");
    window.scrollTo({ top: 0 });
    if (idx.current > 0) { // unwind to the first entry, so back from here leaves the site as on a fresh start
      resetting.current = true;
      window.history.go(-idx.current);
    } else window.history.replaceState({ wz: "need", i: 0 } satisfies HistState, "");
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
  // «قبلی» walks the same history as the phone's back button, so the two never disagree.
  const goBack = () => {
    if (idx.current > 0) return window.history.back();
    const b = usable(back[step]); // a restored tab has no earlier entry: step back in place
    window.history.replaceState({ wz: b, i: 0 } satisfies HistState, "");
    setSheetState(null);
    setStep(b);
  };
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
      {sheet?.kind === "about" && <AboutSheet meta={meta} onClose={() => setSheet(null)} onRestart={step !== "need" ? reset : undefined} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
