import { useState } from "react";
import { fa, HERE, shortPlace } from "../../fmt";
import { Icon } from "../../icons";
import type { Ctx, Meta, TravelMode } from "../../types";
import { activeFilters } from "../ContextBar";
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

export function NeedStep({ need, setNeed, meta, onNext, listen, listening }: {
  need: string;
  setNeed: (s: string) => void;
  meta: Meta | null;
  onNext: (text?: string) => void;
  listen?: () => void;
  listening: boolean;
}) {
  return (
    <>
      <img className="wz-art fadein" src="/img/hero.webp" width={960} height={480} alt="" />
      <StepHead title="چی می‌خوای بخری؟" sub="مدلش رو نمی‌دونی؟ اشکالی نداره، همون‌طور که به فروشنده می‌گی بنویس." />
      <form className="wz-field" onSubmit={(e) => { e.preventDefault(); if (need.trim()) onNext(); }}>
        <input value={need} onChange={(e) => setNeed(e.target.value)} enterKeyHint="next" aria-label="کالایی که می‌خواهید"
          placeholder={listening ? "در حال شنیدن…" : "مثلاً: هدفون بی‌سیم ارزون"} />
        {listen && (
          <button type="button" className={"micbtn" + (listening ? " rec" : "")} onClick={listen} aria-label="گفتن با صدا"><Icon name="mic" size={20} /></button>
        )}
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

export function WhereStep({ ctx, setCtx, meta, toast, onBack, onNext }: {
  ctx: Ctx;
  setCtx: (c: Ctx) => void;
  meta: Meta | null;
  toast: (s: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [all, setAll] = useState(false);
  const places = meta?.places ?? [];
  const shown = all ? places : places.filter((p, i) => i < 4 || p.label === ctx.place);
  const locate = () => {
    if (!navigator.geolocation) return toast("مرورگر موقعیت‌یابی را پشتیبانی نمی‌کند");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const { latitude: lat, longitude: lon } = p.coords;
        if (Math.hypot(lat - FERDOWSI.lat, (lon - FERDOWSI.lon) * 0.81) > 0.5) {
          toast("فعلاً فقط فروشگاه‌های تهران را داریم؛ یکی از محله‌ها را انتخاب کنید");
          return;
        }
        setCtx({ ...ctx, lat, lon, place: HERE });
      },
      () => toast("دسترسی به موقعیت داده نشد؛ یکی از محله‌ها را انتخاب کنید"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };
  return (
    <>
      <StepHead title="از کجا راه می‌افتی؟" sub="نزدیک‌ترین فروشگاه‌ها رو از همین‌جا حساب می‌کنم." />
      <div className="wz-opts" role="radiogroup">
        <Choice on={shortPlace(ctx.place) === HERE} onClick={locate} icon="locate" title="همین‌جا که هستم" sub="با موقعیت‌یاب گوشی" />
        {shown.map((p) => (
          <Choice key={p.id} on={ctx.place === p.label} onClick={() => setCtx({ ...ctx, lat: p.lat, lon: p.lon, place: p.label })} icon="pin" title={p.label} />
        ))}
      </div>
      {!all && places.length > shown.length && (
        <button className="morebtn" onClick={() => setAll(true)}>{fa(places.length - shown.length)} جای دیگه <Icon name="down" size={16} /></button>
      )}
      <WizFoot onBack={onBack} next={{ label: <>ادامه <Icon name="left" size={18} /></>, onClick: onNext }} />
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
  const minutes = ctx.range_mode === "time" ? ctx.range_minutes : null;
  return (
    <>
      <StepHead title="چطوری می‌ری؟" sub="فقط فروشگاه‌هایی رو نشون می‌دم که تا این زمان بهشون می‌رسی." />
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
