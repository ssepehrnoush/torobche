import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { fa, HERE, shortPlace } from "../../fmt";
import { Icon } from "../../icons";
import type { Ctx, Meta, PlaceArea, PlaceHit, TravelMode } from "../../types";
import { activeFilters } from "../ContextBar";
import { MicButton } from "./Mic";
import { Choice, StepHead, WizFoot } from "./Shell";

/* Every example is a real query: each one returns products from the dataset (checked with /api/search). */
const EXAMPLES: [string, string][] = [
  ["mobile", "گوشی سامسونگ تا ۲۰۰ میلیون، قسطی"],
  ["shoe", "کتونی برای پیاده‌روی، مدلش رو نمی‌دونم"],
  ["plug", "شارژر ۲۰ وات اصلی آیفون"],
];
const FERDOWSI = { lat: 35.6998, lon: 51.4197 };
const MODES: [TravelMode, string, string][] = [["walk", "walk", "پیاده"], ["car", "car", "با ماشین یا تاکسی"], ["transit", "train", "با مترو و اتوبوس"]];
const MINUTES = [10, 20, 30, 45, 60];
const PlaceMap = lazy(() => import("./PlaceMap").then((m) => ({ default: m.PlaceMap })));
const HIT_ICON: Record<PlaceHit["kind"], string> = { place: "pin", metro: "train", mall: "store", area: "map" };

export function NeedStep({ need, setNeed, meta, toast, onTalk, onNext }: {
  need: string;
  setNeed: (s: string) => void;
  meta: Meta | null;
  toast: (s: string) => void;
  onTalk: () => void;
  onNext: (text?: string) => void;
}) {
  const voice = !meta || meta.llm.available; // speech goes through the same model gateway
  return (
    <>
      <img className="wz-art fadein" src="/img/hero.webp" width={960} height={480} alt="" />
      <StepHead title="چی می‌خوای بخری؟"
        sub={`مدلش رو نمی‌دونی؟ اشکالی نداره، همون‌طور که به فروشنده می‌گی بنویس${voice ? "، یا میکروفون رو بزن و بگو" : ""}.`} />
      <form className="wz-field" onSubmit={(e) => { e.preventDefault(); if (need.trim()) onNext(); }}>
        <input value={need} onChange={(e) => setNeed(e.target.value)} enterKeyHint="next" aria-label="کالایی که می‌خواهید"
          placeholder="مثلاً: هدفون بی‌سیم ارزون" />
        {voice && <MicButton toast={toast} onStart={onTalk} onText={(t) => { setNeed(t); onNext(t); }} />}
      </form>
      {meta && !meta.llm.available && (
        <div className="notice"><Icon name="info" size={16} /> دستیار هوشمند الان در دسترس نیست؛ با جستجوی ساده پیدا می‌کنم.</div>
      )}
      <div className="wz-examples">
        <span className="meta">یا یکی از این‌ها:</span>
        {EXAMPLES.map(([icon, text]) => (
          <button key={text} className="wz-ex" onClick={() => { setNeed(text); onNext(text); }}>
            <Icon name={icon} size={16} /> {text}
          </button>
        ))}
      </div>
      <WizFoot next={{ label: <>ادامه <Icon name="left" size={18} /></>, onClick: () => onNext(), disabled: !need.trim() }} />
    </>
  );
}

export function WhereStep({ ctx, placed, pickPlace, toast, onTalk, onBack, onNext }: {
  ctx: Ctx;
  placed: boolean;
  pickPlace: (p: { lat: number; lon: number; label: string }, how: "here" | "there") => void;
  toast: (s: string) => void;
  onTalk: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlaceHit[] | null>(null);
  const [areas, setAreas] = useState<PlaceArea[]>([]);
  const [empty, setEmpty] = useState(false); // no shop within a short walk of the tapped point
  const [locating, setLocating] = useState(false);
  const taps = useRef(0); // only the latest tap may rename the pin
  const typing = q.trim().length >= 2;
  const here = placed && shortPlace(ctx.place) === HERE;

  useEffect(() => {
    api.placeAreas().then((r) => setAreas(r.items)).catch(() => {});
  }, []);
  useEffect(() => {
    const t = q.trim();
    setHits(null);
    if (t.length < 2) return;
    const ac = new AbortController();
    const h = window.setTimeout(() => api.places(t, ac.signal).then((r) => setHits(r.items)).catch(() => {}), 180);
    return () => {
      window.clearTimeout(h);
      ac.abort();
    };
  }, [q]);

  const choose = (p: { lat: number; lon: number; label: string }) => {
    taps.current++;
    pickPlace(p, "there");
    setQ("");
    setEmpty(false);
  };
  const tap = (lat: number, lon: number) => {
    const n = ++taps.current;
    pickPlace({ lat, lon, label: "نقطهٔ روی نقشه" }, "there");
    setEmpty(false);
    api.placeAt(lat, lon).then((r) => {
      if (n !== taps.current) return;
      pickPlace({ lat, lon, label: r.label }, "there");
      setEmpty(r.shops_nearby === 0);
    }).catch(() => {});
  };
  const locate = () => {
    if (!navigator.geolocation) return toast("مرورگر موقعیت‌یابی را پشتیبانی نمی‌کند");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        const { latitude: lat, longitude: lon } = p.coords;
        if (Math.hypot(lat - FERDOWSI.lat, (lon - FERDOWSI.lon) * 0.81) > 0.5) {
          toast("فعلاً فقط فروشگاه‌های تهران را داریم؛ روی نقشه جای خرید را بزنید");
          return;
        }
        taps.current++;
        pickPlace({ lat, lon, label: HERE }, "here");
        setEmpty(false);
      },
      () => {
        setLocating(false);
        toast("دسترسی به موقعیت داده نشد؛ روی نقشه جای خرید را بزنید");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <>
      <StepHead title="کجا می‌خوای خرید کنی؟" sub="روی نقشه یا اسم یه محله بزن، یا بنویس کجا." />
      <button className={"wz-opt" + (here ? " on" : "")} onClick={locate} disabled={locating} role="radio" aria-checked={here}>
        <span className="wz-opt-ico"><Icon name="locate" size={20} /></span>
        <span className="grow wz-opt-txt">
          <span className="wz-opt-t">{locating ? "دارم پیدات می‌کنم…" : "نزدیک خودم"}</span>
          <span className="meta">همین‌جا که الان هستی، با موقعیت‌یاب گوشی</span>
        </span>
        <span className={"radio" + (here ? " on" : "")}>{here && <i />}</span>
      </button>
      <form className="wz-field" role="search" onSubmit={(e) => { e.preventDefault(); if (hits?.[0]) choose(hits[0]); }}>
        <Icon name="search" size={19} className="faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" aria-label="جستجوی جای خرید"
          placeholder="مثلاً تجریش، پاساژ علاءالدین یا مترو ونک" />
        {q ? <button type="button" className="micbtn" onClick={() => setQ("")} aria-label="پاک کردن"><Icon name="x" size={18} /></button>
          : <MicButton toast={toast} onStart={onTalk} onText={(t) => setQ(t.replace(/[.؟?!،]+$/, ""))} />}
      </form>
      {typing ? (
        <div className="wz-opts" role="radiogroup" aria-live="polite">
          {hits === null && [0, 1, 2].map((i) => <div key={i} className="shimmer" style={{ height: 56, borderRadius: 14 }} />)}
          {hits?.length === 0 && (
            <div className="wz-say small">«{q.trim()}» رو پیدا نکردم. اسم یه محله، پاساژ یا ایستگاه مترو رو بنویس، یا روی نقشه بزن. فعلاً فروشگاه‌های تهران رو داریم.</div>
          )}
          {hits?.map((p) => (
            <Choice key={p.id} on={placed && ctx.place === p.label} onClick={() => choose(p)} icon={HIT_ICON[p.kind]} title={p.label} sub={p.sub} />
          ))}
        </div>
      ) : (
        <>
          <Suspense fallback={<div className="shimmer mapbox wz-map" />}>
            <PlaceMap areas={areas} chosen={placed && !here ? { lat: ctx.lat, lon: ctx.lon, label: ctx.place } : null} onArea={choose} onTap={tap} />
          </Suspense>
          {placed && !here ? (
            <div className="wz-chosen fadein"><Icon name="pin" size={17} /> <span className="grow ellipsis">خرید از <b>{ctx.place}</b></span></div>
          ) : !placed && <p className="meta center" style={{ margin: 0 }}>روی اسم محله‌ها فروشگاه داریم؛ هر جای دیگهٔ نقشه رو هم می‌شه زد.</p>}
          {empty && <div className="notice"><Icon name="alert" size={16} /> این دور و بر فروشگاهی ثبت نشده؛ نزدیک‌تر به یکی از محله‌های روی نقشه بزن.</div>}
        </>
      )}
      <WizFoot onBack={onBack} next={{ label: <>ادامه <Icon name="left" size={18} /></>, onClick: onNext, disabled: !placed }} />
    </>
  );
}

export function HowStep({ ctx, setCtx, onFilters, onBack, onNext }: {
  ctx: Ctx;
  setCtx: (c: Ctx) => void;
  onFilters: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const n = activeFilters(ctx);
  const here = shortPlace(ctx.place) === HERE;
  const minutes = ctx.range_mode === "time" ? ctx.range_minutes : null;
  return (
    <>
      <StepHead title={here ? "چطوری می‌ری؟" : "اونجا چطوری می‌گردی؟"}
        sub={`فقط فروشگاه‌هایی رو نشون می‌دم که از ${here ? "جایی که هستی" : ctx.place} تا این زمان بهشون می‌رسی.`} />
      <div className="wz-opts" role="radiogroup">
        {MODES.map(([m, icon, label]) => (
          <Choice key={m} on={ctx.travel_mode === m} onClick={() => setCtx({ ...ctx, travel_mode: m })} icon={icon} title={label} />
        ))}
      </div>
      <div className="wz-sub">حداکثر چقدر راه؟</div>
      <div className="wz-mins">
        {MINUTES.map((m) => (
          <button key={m} className={"chip" + (minutes === m ? " on" : "")} onClick={() => setCtx({ ...ctx, range_mode: "time", range_minutes: m })}>
            {fa(m)} دقیقه
          </button>
        ))}
      </div>
      <button className="wz-more" onClick={onFilters}>
        <Icon name="filter" size={17} />
        <span className="grow">{n ? `${fa(n)} شرط دیگه گذاشتی` : "شرط دیگه‌ای داری؟ بودجه، قسطی، اصل بودن"}</span>
        <Icon name="left" size={16} />
      </button>
      <WizFoot onBack={onBack} next={{ label: <><Icon name="search" size={18} /> پیدا کن</>, onClick: onNext }} />
    </>
  );
}
