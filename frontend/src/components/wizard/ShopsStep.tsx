import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "../../api";
import { fa, short, shortPlace, toman } from "../../fmt";
import { Icon } from "../../icons";
import type { Authenticity, Ctx, GenShops, MapPath, ShopOffer, ShopsResult, TravelMode } from "../../types";
import { activeFilters } from "../ContextBar";
import { AuthBadge, OpenText, PriceAge, TravelInline } from "../bits";
import { Img } from "../Products";
import { GenBadge } from "./GenStep";
import { StepHead, WizFoot } from "./Shell";

const MapView = lazy(() => import("../MapView").then((m) => ({ default: m.MapView })));
const FIRST = 5; // rows shown before «بیشتر»
const MAX_SEL = 5;

/** Step 5: a short list of nearby shops, the best three already ticked. Everything else waits behind one button.
    Generative UI: the model also decides what opens the screen above the list (the one shop it recommends,
    a map with prices, a cheaper shop a little further, or nothing); the list shows at once, the layout
    joins when it is ready, so nobody waits on the model. */
export function ShopsStep({ pid, ctx, setCtx, picks, need, onBack, onAsk, onGo, onOpenShop, onDetails, onFilters, onPlace }: {
  pid: number;
  ctx: Ctx;
  setCtx: (c: Ctx) => void;
  picks: { sid: number; why: string }[];
  need?: string;
  onBack: () => void;
  onFilters?: () => void;
  onPlace?: () => void;
  onAsk: (sids: number[]) => void;
  onGo: (sids: number[]) => void;
  onOpenShop: (sid: number, auth?: Authenticity) => void;
  onDetails: () => void;
}) {
  const [data, setData] = useState<ShopsResult | null>(null);
  const [err, setErr] = useState(false);
  const [sel, setSel] = useState<number[]>([]);
  const [chosen, setChosen] = useState<number[]>([]); // the first selection stays in the short list even if it sits lower
  const [all, setAll] = useState(false);
  const [tries, setTries] = useState(0);
  const [layout, setLayout] = useState<GenShops | null>(null);
  const ctxKey = JSON.stringify(ctx);

  useEffect(() => {
    if (need === undefined) return;
    const ac = new AbortController();
    setLayout(null);
    const t = window.setTimeout(() => api.genShops(pid, ctx, need, ac.signal).then(setLayout).catch(() => {}), 700);
    return () => { window.clearTimeout(t); ac.abort(); };
  }, [pid, ctxKey]); // eslint-disable-line

  useEffect(() => {
    const ac = new AbortController();
    setErr(false);
    setData(null);
    api.shops(pid, ctx, "best", [], ac.signal).then((d) => {
      setData(d);
      const pickIds = picks.map((p) => p.sid).filter((sid) => d.items.some((i) => i.sid === sid));
      const auto = d.items.filter((i) => i.in_radius && i.open_at_visit.state !== "closed" && i.authenticity?.status !== "declared_copy").map((i) => i.sid);
      const first = Array.from(new Set([...pickIds, ...auto])).slice(0, 3);
      setSel(first);
      setChosen(first);
    }).catch((e) => e.name !== "AbortError" && setErr(true));
    return () => ac.abort();
  }, [pid, ctxKey, tries]); // eslint-disable-line

  const items = data?.items ?? [];
  const near = items.filter((i) => i.in_radius);
  const far = items.filter((i) => !i.in_radius);
  // A much cheaper shop a little further away earns a place in the short list, labelled with what it saves.
  const bargain = data?.bargain && far.find((i) => i.sid === data.bargain!.sid) ? data.bargain : null;
  const inTop = (i: ShopOffer, idx: number) => idx < FIRST || chosen.includes(i.sid);
  const top = [...(bargain ? far.filter((i) => i.sid === bargain.sid) : []), ...near.filter(inTop)];
  const rest = [...near.filter((i, idx) => !inTop(i, idx)), ...far.filter((i) => i.sid !== bargain?.sid)];
  const priced = near.filter((i) => i.price && !i.price_warning && i.authenticity?.status !== "declared_copy");
  const cheapest = priced.length > 1 ? priced.reduce((a, b) => (b.price! < a.price! ? b : a)).sid : null; // «ارزان‌ترین» needs a second shop
  const toggle = (sid: number) => setSel((s) => (s.includes(sid) ? s.filter((x) => x !== sid) : s.length >= MAX_SEL ? s : [...s, sid]));
  const p = data?.product;
  const range = data?.range?.label ?? "نزدیک شما";
  const expand = (data?.expand ?? []).filter((e) => e.count > near.length).slice(0, 3);

  const row = (i: ShopOffer) => (
    <ShopRow key={i.sid} i={i} on={sel.includes(i.sid)} cheapest={i.sid === cheapest} saving={i.sid === bargain?.sid ? bargain.saving : null}
      onToggle={() => toggle(i.sid)} onInfo={() => onOpenShop(i.sid, i.authenticity)} />
  );

  return (
    <>
      <StepHead title={layout?.source === "model" && layout.title ? layout.title : "از کدوم فروشگاه‌ها بپرسیم؟"}
        sub={!data ? " " : near.length ? `${fa(near.length)} فروشگاه ${range} این کالا رو دارن. بهترین‌ها رو انتخاب کردم؛ اگه خواستی عوضشون کن.` : undefined} />

      <button className="wz-prodline" onClick={onDetails} aria-label="مشخصات کالا">
        <Img src={p?.image ?? null} className="pimg xs" />
        <span className="grow ellipsis">{p?.title ?? "…"}</span>
        <span className="linkbtn">مشخصات</span>
      </button>

      {onFilters && onPlace && <CondBar ctx={ctx} setCtx={setCtx} onFilters={onFilters} onPlace={onPlace} />}

      {data && near.length > 0 && <ShopMap near={near} ctx={ctx} sel={sel} cheapest={cheapest} onToggle={toggle} />}

      {layout && data && near.length > 0 && (
        <GenLayout layout={layout} near={near} bargain={bargain} sel={sel} onToggle={toggle}
          onAsk={onAsk} onGo={onGo} onOpenShop={onOpenShop} />
      )}

      {err && <div className="card empty">دریافت فروشگاه‌ها ناموفق بود. <button className="textbtn" onClick={() => setTries(tries + 1)}>تلاش دوباره</button></div>}
      {!data && !err && <div className="card list-skel">{[0, 1, 2].map((i) => <div key={i} className="shimmer" style={{ height: 60 }} />)}</div>}

      {data && near.length === 0 && (
        <div className="card empty">
          <img className="empty-art" src="/img/empty.webp" width={480} height={480} alt="" />
          <b>{range} فروشگاهی این کالا رو نداره</b>
          <span className="meta">وسیله یا محدوده رو عوض کن{activeFilters(ctx) ? "، یا شرط‌ها رو بردار" : ""}.</span>
          <div className="chips center" style={{ marginTop: 8 }}>
            {/* a walk too short for any shop: one tap to go by car or metro instead (the minutes stay) */}
            {MODES.filter(([k]) => k !== ctx.travel_mode).map(([k, label, icon]) => (
              <button key={k} className="chip" onClick={() => setCtx({ ...ctx, travel_mode: k })}><Icon name={icon} size={15} /> {label}</button>
            ))}
            {expand.map((e) => (
              <button key={e.label} className="chip" onClick={() => setCtx(e.minutes ? { ...ctx, range_mode: "time", range_minutes: e.minutes } : { ...ctx, range_mode: "km", radius_km: e.km ?? ctx.radius_km })}>
                {e.label} <small>{fa(e.count)} فروشگاه</small>
              </button>
            ))}
            {activeFilters(ctx) > 0 && (
              <button className="chip" onClick={() => setCtx({ ...ctx, visit: "now", budget_max: null, budget_min: null, installments_only: false, open_only: false, torob_pay_only: false, originality: "any" })}>
                برداشتن شرط‌ها
              </button>
            )}
          </div>
        </div>
      )}

      {top.length > 0 && <div className="wz-opts">{top.map(row)}</div>}
      {rest.length > 0 && !all && (
        <button className="morebtn" onClick={() => setAll(true)}>{fa(rest.length)} فروشگاه دیگه <Icon name="down" size={16} /></button>
      )}
      {all && rest.length > 0 && <div className="wz-opts fadein">{rest.map(row)}</div>}

      {data && items.length > 0 && <p className="footnote"><Icon name="info" size={13} /> قیمت‌ها همون ثبت‌شده در ترب هست؛ موجودی رو با پرسیدن مطمئن می‌شیم.</p>}

      <WizFoot onBack={onBack} next={{ label: <><Icon name="chat" size={18} /> بپرس از {fa(sel.length)} فروشگاه</>, onClick: () => onAsk(sel), disabled: !sel.length }}>
        {sel.length > 0 && <button className="textbtn center wz-skip" onClick={() => onGo(sel)}>بدون پرسیدن، فقط مسیر رو بده</button>}
      </WizFoot>
    </>
  );
}

const STRIP_H = 150;
const OPEN_H = 380;

/** The near shops on a map, like Torob's own: a short illustrated strip above the list (blue pins, the hopping
    radish) that opens the real map, each shop a pin with its price above it; a tap ticks it or not. */
function ShopMap({ near, ctx, sel, cheapest, onToggle }: {
  near: ShopOffer[]; ctx: Ctx; sel: number[]; cheapest: number | null; onToggle: (sid: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [way, setWay] = useState<MapPath | null>(null);
  const pins = near.slice(0, 15).map((i) => ({
    id: i.sid, lat: i.lat, lon: i.lon, label: i.price ? short(i.price) : "؟",
    tone: sel.includes(i.sid) ? "pick" as const : i.open_at_visit.state === "closed" ? "closed" as const : i.sid === cheapest ? "cheap" as const : "normal" as const,
  }));
  // the way from the radish to the first ticked shop (or the nearest), along the streets like a map app's directions
  const to = sel.find((s) => near.some((i) => i.sid === s)) ?? near[0]?.sid;
  useEffect(() => {
    if (!to) return;
    let alive = true;
    api.way(to, ctx).then((w) => alive && setWay(w)).catch(() => alive && setWay(null));
    return () => { alive = false; };
  }, [to, ctx.lat, ctx.lon, ctx.travel_mode]); // eslint-disable-line
  // one real map: a still strip like Torob's (blue pins, the radish, the way), opening in place to the full map
  const shown = open ? pins : pins.map((p) => ({ ...p, tone: p.tone === "closed" ? "closed" as const : "normal" as const }));
  return (
    <div className={"wz-shopmap" + (open ? " open" : "")} onClick={open ? undefined : () => setOpen(true)}>
      <Suspense fallback={<div className="shimmer mapbox" style={{ height: STRIP_H }} />}>
        <MapView you={{ lat: ctx.lat, lon: ctx.lon }} pins={shown} onPick={open ? onToggle : undefined} height={open ? OPEN_H : STRIP_H}
          chips={open} still={!open} paths={way ? [way] : undefined} />
      </Suspense>
      <button className="wz-mapbtn" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} aria-expanded={open}>
        {open ? <Icon name="up" size={16} /> : (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9V3h6M3 3l9 9" /></svg>
        )}
        {open ? "کوچیک کن" : "فروشگاه‌ها روی نقشه"}
      </button>
    </div>
  );
}

const MODES: [TravelMode, string, string][] = [["walk", "پیاده", "walk"], ["car", "با ماشین", "car"], ["transit", "مترو و اتوبوس", "train"]];
const MINUTES = [10, 20, 30, 45, 60];

/** The search's conditions, changeable right where the results are: the list follows each tap, no going back.
    Place opens the map page and returns here; range opens its own two rows; the rest are one-tap switches. */
function CondBar({ ctx, setCtx, onFilters, onPlace }: { ctx: Ctx; setCtx: (c: Ctx) => void; onFilters: () => void; onPlace: () => void }) {
  const [range, setRange] = useState(false);
  const mode = MODES.find((m) => m[0] === ctx.travel_mode) ?? MODES[0];
  const flip = (k: "installments_only" | "open_only") => setCtx({ ...ctx, [k]: !ctx[k] });
  const original = ctx.originality === "original_only";
  const more = (ctx.visit !== "now" ? 1 : 0) + (ctx.torob_pay_only ? 1 : 0);
  return (
    <div className="wz-cond">
      <div className="chips nowrap" role="toolbar" aria-label="شرط‌های جستجو">
        <button className="chip sm" onClick={onPlace}><Icon name="pin" size={14} /> {shortPlace(ctx.place)}</button>
        <button className={"chip sm" + (range ? " on" : "")} onClick={() => setRange(!range)} aria-expanded={range}>
          <Icon name={mode[2]} size={14} /> {ctx.range_mode === "km" ? `${fa(ctx.radius_km)} کیلومتر` : `${fa(ctx.range_minutes)} دقیقه ${mode[1]}`}
          <Icon name="down" size={13} />
        </button>
        <button className={"chip sm" + (ctx.budget_max ? " on" : "")} onClick={onFilters}>{ctx.budget_max ? `تا ${short(ctx.budget_max)}` : "بودجه"}</button>
        <button className={"chip sm" + (ctx.installments_only ? " on" : "")} onClick={() => flip("installments_only")} aria-pressed={ctx.installments_only}>قسطی</button>
        <button className={"chip sm" + (ctx.open_only ? " on" : "")} onClick={() => flip("open_only")} aria-pressed={ctx.open_only}>فقط بازها</button>
        <button className={"chip sm" + (original ? " on" : "")} onClick={() => setCtx({ ...ctx, originality: original ? "any" : "original_only" })} aria-pressed={original}>فقط اصل</button>
        <button className={"chip sm" + (more ? " on" : "")} onClick={onFilters}><Icon name="filter" size={14} /> {more ? `${fa(more)} شرط دیگه` : "شرط‌های دیگه"}</button>
      </div>
      {range && (
        <div className="wz-cond-pop fadein">
          <div className="chips">
            {MODES.map(([k, label, icon]) => (
              <button key={k} className={"chip sm" + (ctx.travel_mode === k ? " on" : "")} onClick={() => setCtx({ ...ctx, travel_mode: k })}>
                <Icon name={icon} size={14} /> {label}
              </button>
            ))}
          </div>
          <div className="chips">
            {MINUTES.map((v) => (
              <button key={v} className={"chip sm" + (ctx.range_mode === "time" && ctx.range_minutes === v ? " on" : "")}
                onClick={() => { setCtx({ ...ctx, range_mode: "time", range_minutes: v }); setRange(false); }}>
                تا {fa(v)} دقیقه
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Two lines only: name and price; how far and whether it is open. One tag at most. */
function ShopRow({ i, on, cheapest, saving, onToggle, onInfo }: {
  i: ShopOffer;
  on: boolean;
  cheapest: boolean;
  saving: number | null;
  onToggle: () => void;
  onInfo: () => void;
}) {
  const tag = i.authenticity?.status === "declared_copy" || i.authenticity?.status === "suspicious" ? <AuthBadge a={i.authenticity} />
    : i.price_warning ? <span className="tag red">قیمت مشکوک</span>
    : saving ? <span className="tag green">{toman(saving)} ارزان‌تر</span>
    : cheapest ? <span className="badge">ارزان‌ترین</span> : null;
  return (
    <div className={"wz-shop" + (on ? " on" : "")}>
      <button className="wz-shop-main" onClick={onToggle} role="checkbox" aria-checked={on}>
        <span className={"selbox" + (on ? " on" : "")}>{on && <Icon name="check" size={14} stroke={2.6} />}</span>
        <span className="grow wz-opt-txt">
          <span className="r1"><span className="name ellipsis">{i.name}</span><span className="amount">{i.price ? toman(i.price) : "بدون قیمت"}</span></span>
          <span className="r3"><TravelInline t={i.travel} /><OpenText s={i.open_at_visit} /><PriceAge f={i.freshness} />{tag}</span>
        </span>
      </button>
      <button className="wz-info" onClick={onInfo} aria-label={`جزئیات ${i.name}`}><Icon name="info" size={18} /></button>
    </div>
  );
}

/** What opens the shops screen, chosen by the model; the usual list follows it. */
function GenLayout({ layout, near, bargain, sel, onToggle, onAsk, onGo, onOpenShop }: {
  layout: GenShops;
  near: ShopOffer[];
  bargain: ShopsResult["bargain"] | null;
  sel: number[];
  onToggle: (sid: number) => void;
  onAsk: (sids: number[]) => void;
  onGo: (sids: number[]) => void;
  onOpenShop: (sid: number, auth?: Authenticity) => void;
}) {
  const badge = layout.why ? <GenBadge s={layout} /> : null;
  if (layout.layout === "best") {
    const b = near.find((i) => i.sid === layout.best_sid);
    if (!b) return badge;
    return (
      <>
        {badge}
        <div className="gen-best fadein">
          <span className="gen-best-tag"><Icon name="spark" size={14} /> پیشنهاد من</span>
          <button className="gen-best-main" onClick={() => onOpenShop(b.sid, b.authenticity)}>
            <span className="r1"><span className="name ellipsis">{b.name}</span><span className="amount">{b.price ? toman(b.price) : "بدون قیمت"}</span></span>
            <span className="r3"><TravelInline t={b.travel} /><OpenText s={b.open_at_visit} /><PriceAge f={b.freshness} /></span>
            {layout.reason && <span className="gen-best-why">{layout.reason}</span>}
          </button>
          <div className="gen-best-btns">
            <button className="btn sm grow" onClick={() => onAsk([b.sid])}><Icon name="chat" size={16} /> فقط از همین بپرس</button>
            <button className="btn ghost sm" onClick={() => onGo([b.sid])}><Icon name="route" size={16} /> مسیرش</button>
          </div>
        </div>
        <p className="meta" style={{ margin: "4px 4px 0" }}>یا از چند تا با هم بپرس:</p>
      </>
    );
  }
  if (layout.layout === "map") {
    // the map itself is always above the list now (ShopMap); here only why the model chose it
    return <>{badge}<p className="meta center" style={{ margin: 0 }}>روی نقشهٔ بالا، روی هر قیمت بزنی اون مغازه انتخاب یا حذف می‌شه.</p></>;
  }
  if (layout.layout === "bargain" && bargain) {
    const on = sel.includes(bargain.sid);
    return (
      <>
        {badge}
        <div className="gen-best bargain fadein">
          <span className="gen-best-tag"><Icon name="tag" size={14} /> ارزون‌تر، کمی دورتر</span>
          <span className="r1"><span className="name ellipsis">{bargain.name}</span><span className="amount">{bargain.price ? toman(bargain.price) : ""}</span></span>
          <span className="meta">{bargain.saving ? `${toman(bargain.saving)} ارزون‌تر · ` : ""}{bargain.travel_label}</span>
          <button className={"btn sm " + (on ? "ghost" : "")} onClick={() => onToggle(bargain.sid)}>{on ? "انتخاب شد" : "اینم بپرس"}</button>
        </div>
      </>
    );
  }
  return layout.source === "model" ? badge : null;
}
