import { useCallback, useEffect, useRef, useState } from "react";
import { api, get } from "./api";
import { AboutSheet } from "./components/AboutSheet";
import { FiltersSheet } from "./components/ContextBar";
import { DesktopAside } from "./components/DesktopAside";
import type { InquiryState } from "./components/InquiryView";
import { RadishLogo } from "./components/Logo";
import { ProductSheet } from "./components/Products";
import { ShopSheet } from "./components/ShopSheet";
import { GenBadge, GenFailed, GenStep, GenWait } from "./components/wizard/GenStep";
import { GoStep } from "./components/wizard/GoStep";
import { InquiryStep } from "./components/wizard/InquiryStep";
import { Progress } from "./components/wizard/Shell";
import { ShopsStep } from "./components/wizard/ShopsStep";
import { HowStep, NeedStep, WhereStep } from "./components/wizard/StartSteps";
import { fa } from "./fmt";
import { Icon } from "./icons";
import type { Authenticity, Ctx, GenAnswer, GenKnown, GenTurn, Meta } from "./types";
import "./wizard.css";

/* Generative UI copy of the map wizard: after «چی می‌خوای بخری؟» every screen is built by the model
   (backend genui.py) from a fixed box of blocks, so it skips what the person already said and picks the
   widget that fits. Shops, the inquiry and the visit plan stay the fixed wizard's own steps. */
type Step = "need" | "gen" | "shops" | "ask" | "go";
const ORDER: Step[] = ["need", "gen", "shops", "ask", "go"];
type SheetState = null | { kind: "shop"; sid: number; auth?: Authenticity } | { kind: "product"; pid: number } | { kind: "about" } | { kind: "filters" } | { kind: "place" };
const TRAVEL_FA: Record<string, string> = { walk: "پیاده", car: "با ماشین", transit: "با مترو و اتوبوس" };

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

/* Where the person is survives a reload or the browser killing a background tab, for as long as the tab lives. */
const SAVE_KEY = "torobche.gen";
type Visit = { pid: number | null; sids: number[]; confirmed: Record<number, unknown> | null; asked: boolean };
type Saved = {
  step: Step; need: string; gens: GenTurn[]; answers: GenAnswer[]; genIdx: number; known: GenKnown;
  pid: number | null; inq: InquiryState | null; visit: Visit | null; placed: boolean; lastPick: "here" | "there" | null;
};

function loadSaved(): Partial<Saved> {
  try {
    const s = JSON.parse(sessionStorage.getItem(SAVE_KEY) || "{}") as Partial<Saved>;
    if (!s.step || !ORDER.includes(s.step)) return {};
    const n = s.gens?.length ?? 0;
    if (s.step === "gen" && !n) return { ...s, step: "need", genIdx: 0 };
    return { ...s, genIdx: Math.min(s.genIdx ?? 0, Math.max(0, n - 1)) };
  } catch {
    return {};
  }
}

/* Each step, and each generated screen, is a browser history entry, so the phone's back button goes one
   screen back instead of leaving the site. `g` is the generated screen's index. */
type HistState = { wz: Step; i: number; g?: number; sheet?: boolean };
const hist = (): HistState | null => {
  const s = window.history.state as HistState | null;
  return s && ORDER.includes(s.wz) ? s : null;
};

/* Budget, installments and the like belong to one search: a new need starts without them, the trip settings stay. */
const NO_FILTERS: Partial<Ctx> = { visit: "now", budget_min: null, budget_max: null, installments_only: false, torob_pay_only: false, open_only: false, originality: "any" };
const NOTHING_KNOWN: GenKnown = { place: false, travel: false };

export default function Wizard() {
  const [saved] = useState(loadSaved);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [ctx, setCtxState] = useState<Ctx>(loadCtx);
  const [step, setStep] = useState<Step>(saved.step ?? "need");
  const [need, setNeed] = useState(saved.need ?? "");
  const [gens, setGens] = useState<GenTurn[]>(saved.gens ?? []);
  const [answers, setAnswers] = useState<GenAnswer[]>(saved.answers ?? []);
  const [genIdx, setGenIdx] = useState(saved.genIdx ?? 0);
  const [genBusy, setGenBusy] = useState(false);
  const [pid, setPid] = useState<number | null>(saved.pid ?? null);
  const [inq, setInq] = useState<InquiryState | null>(saved.inq ?? null);
  const [visit, setVisit] = useState<Visit | null>(saved.visit ?? null);
  const [sheet, setSheetState] = useState<SheetState>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [placed, setPlaced] = useState(saved.placed ?? false);
  const known = useRef<GenKnown>(saved.known ?? NOTHING_KNOWN);
  const lastPick = useRef<"here" | "there" | null>(saved.lastPick ?? null);
  const ctxRef = useRef<Ctx>(ctx);
  const idx = useRef(0);
  const resetting = useRef(false);
  const pre = useRef(new Map<string, Promise<GenTurn>>()); // next screens asked for before «ادامه», by need + answers
  const data = useRef({ pid, inq, visit, need, gens });
  data.current = { pid, inq, visit, need, gens };
  const demo = new URLSearchParams(window.location.search).has("demo");

  useEffect(() => {
    get<Meta>("/api/meta").then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const s: Saved = { step, need, gens, answers, genIdx, known: known.current, pid, inq, visit, placed, lastPick: lastPick.current };
      sessionStorage.setItem(SAVE_KEY, JSON.stringify(s));
    } catch {
      /* storage full or blocked: works, just not across a reload */
    }
  }, [step, need, gens, answers, genIdx, pid, inq, visit, placed]);

  const usable = (s: Step): Step => {
    const d = data.current;
    if (s === "go" && !d.visit) return usable(d.inq ? "ask" : "shops");
    if (s === "ask" && !d.inq) return usable("shops");
    if (s === "shops" && d.pid == null) return usable("gen");
    if (s === "gen" && (!d.need.trim() || !d.gens.length)) return "need";
    return s;
  };

  useEffect(() => {
    const h = hist();
    idx.current = h?.i ?? 0;
    window.history.replaceState({ wz: step, i: idx.current, g: step === "gen" ? genIdx : undefined } satisfies HistState, "");
    const onPop = () => {
      const h = hist();
      if (!h) return;
      setSheetState(null);
      if (resetting.current) {
        resetting.current = false;
        idx.current = 0;
        window.history.replaceState({ wz: "need", i: 0 } satisfies HistState, "");
        setStep("need");
        return;
      }
      idx.current = h.i;
      const s = usable(h.wz);
      if (s === "gen") setGenIdx(Math.min(h.g ?? 0, data.current.gens.length - 1));
      setStep(s);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []); // eslint-disable-line

  const setSheet = (s: SheetState) => {
    if (s && !sheet) {
      idx.current++;
      window.history.pushState({ wz: step, i: idx.current, sheet: true } satisfies HistState, "");
    }
    if (!s && sheet && hist()?.sheet) window.history.back();
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

  const pickPlace = (p: { lat: number; lon: number; label: string }, how: "here" | "there") => {
    const c = { ...ctxRef.current, lat: p.lat, lon: p.lon, place: p.label };
    if (lastPick.current !== how) Object.assign(c, how === "here" ? { travel_mode: "car", range_mode: "time", range_minutes: 20 } : { travel_mode: "walk", range_mode: "time", range_minutes: 20 });
    lastPick.current = how;
    setPlaced(true);
    setCtx(c);
  };

  const push = (s: Step, g?: number) => {
    idx.current++;
    window.history.pushState({ wz: s, i: idx.current, g } satisfies HistState, "");
  };

  const go = (s: Step) => {
    if (hist()?.sheet) window.history.replaceState({ wz: s, i: idx.current } satisfies HistState, "");
    else if (s !== step) push(s, s === "gen" ? 0 : undefined);
    setSheetState(null);
    setStep(s);
    window.scrollTo({ top: 0 });
  };

  /** The screen after these answers: one request per need + answers, shared by the prefetch and «ادامه». */
  const turnFor = (text: string, ans: GenAnswer[], at: number): Promise<GenTurn> => {
    const key = JSON.stringify([text, ans, ctxRef.current]);
    let p = pre.current.get(key);
    if (!p) {
      const prev = at > 0 ? data.current.gens[at - 1]?.search ?? null : null;
      p = api.genNext({ need: text, answers: ans, ctx: ctxRef.current, known: known.current, search: prev });
      p.catch(() => pre.current.delete(key));
      pre.current.set(key, p);
    }
    return p;
  };
  const prefetching = useRef(false);
  const prefetch = (at: number, a: GenAnswer) => {
    if (genBusy || prefetching.current) return;
    prefetching.current = true;
    turnFor(need.trim(), [...answers.slice(0, at), a], at + 1).catch(() => {}).finally(() => { prefetching.current = false; });
  };

  /** Ask the model for the screen that comes after these answers, and show it as screen `at`. */
  const genFetch = async (text: string, ans: GenAnswer[], at: number) => {
    setGenBusy(true);
    setGenIdx(at);
    try {
      const r = await turnFor(text, ans, at);
      known.current = r.known;
      setCtx({ ...ctxRef.current, ...r.ctx });
      setGens((g) => [...g.slice(0, at), r]);
    } catch {
      toast("ساختن صفحهٔ بعد نشد؛ دوباره امتحان کن");
      setGenIdx(Math.max(0, at - 1));
    }
    setGenBusy(false);
    window.scrollTo({ top: 0 });
  };

  const answerGen = (at: number, a: GenAnswer, learned?: Partial<GenKnown>) => {
    if (genBusy) return;
    if (learned) known.current = { ...known.current, ...learned };
    const ans = [...answers.slice(0, at), a];
    setAnswers(ans);
    push("gen", at + 1);
    genFetch(need.trim(), ans, at + 1);
  };

  const openShops = (p: number) => {
    setPid(p);
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

  const reset = () => {
    if (genBusy) return;
    lastPick.current = null;
    known.current = NOTHING_KNOWN;
    pre.current.clear();
    setPlaced(false);
    setCtx({ ...ctxRef.current, ...NO_FILTERS });
    setNeed("");
    setGens([]);
    setAnswers([]);
    setGenIdx(0);
    setPid(null);
    setInq(null);
    setVisit(null);
    setSheetState(null);
    setStep("need");
    window.scrollTo({ top: 0 });
    if (idx.current > 0) {
      resetting.current = true;
      window.history.go(-idx.current);
    } else window.history.replaceState({ wz: "need", i: 0 } satisfies HistState, "");
  };

  const goBack = () => {
    if (idx.current > 0) return window.history.back();
    if (step === "gen" && genIdx > 0) return setGenIdx(genIdx - 1); // a restored tab has no earlier entry
    const b = usable(step === "gen" ? "need" : step === "shops" ? "gen" : step === "ask" ? "shops" : "ask");
    window.history.replaceState({ wz: b, i: 0 } satisfies HistState, "");
    setSheetState(null);
    setStep(b);
  };
  const openShop = (sid: number, auth?: Authenticity) => setSheet({ kind: "shop", sid, auth });
  const sheetPid = step === "go" ? visit?.pid ?? pid : step === "ask" ? inq?.pid ?? pid : pid;
  const cur = gens[genIdx];

  return (
    <div className="app wz">
      <DesktopAside />
      <header className="top">
        <div className="bar">
          <div className="wordmark" aria-label="تربچه، خرید حضوری">
            <RadishLogo size={28} />
            <b>تربچه</b>
            <i className="sep" />
            <span>خرید حضوری</span>
            <span className="gen-tag">صفحه‌ساز</span>
          </div>
          <div className="spacer" />
          {step !== "need" && (
            <button className="textbtn muted wz-restart" onClick={reset} disabled={genBusy}><Icon name="refresh" size={16} /> از اول</button>
          )}
          <button className="iconbtn" onClick={() => setSheet({ kind: "about" })} aria-label="دربارهٔ داده و روش کار">
            <Icon name="info" size={21} />
          </button>
        </div>
        <Progress idx={ORDER.indexOf(step)} n={ORDER.length} />
      </header>

      <main className="wz-main" key={`${step}:${step === "gen" ? genIdx : ""}`}>
        {step === "need" && <NeedStep need={need} setNeed={setNeed} meta={meta}
          onNext={(t) => {
            const text = (t ?? need).trim();
            if (t) setNeed(t);
            setCtx({ ...ctxRef.current, ...NO_FILTERS });
            known.current = NOTHING_KNOWN;
            pre.current.clear();
            setPlaced(false);
            setAnswers([]);
            setGens([]);
            go("gen");
            genFetch(text, [], 0);
          }} />}

        {step === "gen" && (genBusy ? <GenWait onBack={goBack} /> : !cur ? (
          <GenFailed onBack={goBack} onRetry={() => genFetch(need.trim(), answers.slice(0, genIdx), genIdx)} />
        ) : cur.screen.block === "place" ? (
          <>
            <GenBadge s={cur.screen} />
            <WhereStep ctx={ctx} placed={placed} pickPlace={pickPlace} toast={toast} onBack={goBack}
              onNext={() => answerGen(genIdx, { q: cur.screen.title, a: ctxRef.current.place }, { place: true })} />
          </>
        ) : cur.screen.block === "travel" ? (
          <>
            <GenBadge s={cur.screen} />
            <HowStep ctx={ctx} setCtx={setCtx} onFilters={() => setSheet({ kind: "filters" })} onBack={goBack}
              onNext={() => answerGen(genIdx, { q: cur.screen.title,
                a: `${TRAVEL_FA[ctxRef.current.travel_mode] ?? ""} تا ${fa(ctxRef.current.range_minutes)} دقیقه` }, { travel: true })} />
          </>
        ) : (
          <GenStep s={cur.screen} busy={genBusy} onBack={goBack} onAnswer={(a) => answerGen(genIdx, a)}
            onIntent={(a) => prefetch(genIdx, a)} onPick={openShops} onRestart={reset} />
        ))}

        {step === "shops" && pid != null && (sheet?.kind === "place" ? (
          // the same «کجا» page, opened from the shops screen's conditions; «ادامه» brings the list back for the new place
          // keeps the trip settings already chosen on the shops screen, unlike a first pick
          <WhereStep ctx={ctx} placed={placed || !!ctx.place} toast={toast} onBack={() => setSheet(null)} onNext={() => setSheet(null)}
            pickPlace={(p) => { setPlaced(true); setCtx({ ...ctxRef.current, lat: p.lat, lon: p.lon, place: p.label }); }} />
        ) : (
          <ShopsStep key={pid} pid={pid} ctx={ctx} setCtx={setCtx} picks={[]} need={need} onBack={goBack} onOpenShop={openShop}
            onAsk={(sids) => startInquiry(pid, sids)} onGo={(sids) => startVisit(pid, sids, null, false)}
            onDetails={() => setSheet({ kind: "product", pid })}
            onFilters={() => setSheet({ kind: "filters" })} onPlace={() => setSheet({ kind: "place" })} />
        ))}
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
