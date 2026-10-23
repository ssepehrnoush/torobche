import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { api } from "../api";
import { fa, short, toman } from "../fmt";
import { Icon } from "../icons";
import type { Bargain, Ctx, Freshness, OpenState, ProductCard as PC, ShopBrief, ShopOffer, ShopsResult } from "../types";
import { AiNote, AuthBadge, BargainCard, OpenText, TravelInline } from "./bits";
import { Img, availability } from "./Products";
import { ScrollRow } from "./ScrollRow";

const MapView = lazy(() => import("./MapView").then((m) => ({ default: m.MapView })));

export function openTone(s: OpenState): "green" | "red" | "gray" {
  return s.state === "open" ? "green" : s.state === "closed" ? "red" : "gray";
}
export function freshTone(f: Freshness): "green" | "amber" | "red" | "gray" {
  return f.tier === "fresh" ? "green" : f.tier === "aging" ? "amber" : f.tier === "stale" ? "red" : "gray";
}

type Props = {
  pid: number;
  ctx: Ctx;
  setCtx: (c: Ctx) => void;
  picks: { sid: number; why: string }[];
  agentMsg: string | null;
  focus: number | null;
  onOpenShop: (sid: number, offer?: ShopOffer) => void;
  onInquiry: (sids: number[]) => void;
  onVisit: (sids: number[]) => void;
  onProduct: (p: PC) => void;
  onDetails: () => void;
};

const HIDDEN_LABEL: Record<string, string> = {
  installments: "فیلتر قسطی",
  torob_pay: "فیلتر ترب‌پی",
  open: "فیلتر «فقط باز»",
  original: "فیلتر «فقط کالای اصل»",
};
const UNHIDE: Record<string, Partial<Ctx>> = {
  installments: { installments_only: false }, torob_pay: { torob_pay_only: false }, open: { open_only: false }, original: { originality: "any" },
};
const SORTS: [string, string][] = [["best", "پیشنهادی"], ["cheapest", "ارزان‌ترین"], ["nearest", "نزدیک‌ترین"]];

export function ShopsView({ pid, ctx, setCtx, picks, agentMsg, focus, onOpenShop, onInquiry, onVisit, onProduct, onDetails }: Props) {
  const [sort, setSort] = useState("best");
  const [view, setView] = useState<"list" | "map">("list");
  const [data, setData] = useState<ShopsResult | null>(null);
  const [err, setErr] = useState(false);
  const [insight, setInsight] = useState<{ headline: string; body: string; pick_sid: number | null } | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [showFar, setShowFar] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const touched = useRef(false); // once the user ticks a box, stop auto-selecting
  const ctxKey = JSON.stringify(ctx);

  useEffect(() => {
    const ac = new AbortController();
    setErr(false);
    api.shops(pid, ctx, sort, [], ac.signal).then((d) => {
      setData(d);
      if (!touched.current) {
        const pickIds = picks.map((p) => p.sid).filter((sid) => d.items.some((i) => i.sid === sid));
        const auto = d.items.filter((i) => i.in_radius && i.open_at_visit.state !== "closed").map((i) => i.sid);
        setSel(Array.from(new Set([...pickIds, ...auto])).slice(0, 3));
      }
    }).catch((e) => e.name !== "AbortError" && setErr(true));
    return () => ac.abort();
  }, [pid, ctxKey, sort]); // eslint-disable-line

  useEffect(() => {
    const ac = new AbortController();
    setInsight(null);
    api.insight(pid, ctx, ac.signal).then(setInsight).catch(() => {});
    return () => ac.abort();
  }, [pid, ctxKey]); // eslint-disable-line

  const items = data?.items ?? [];
  const near = items.filter((i) => i.in_radius);
  const far = items.filter((i) => !i.in_radius);

  // «بله، بررسی کنیم»: bring the bargain shop into view, select it and flash it once.
  const reveal = (sid: number) => {
    const it = items.find((i) => i.sid === sid);
    if (!it) return;
    if (!it.in_radius) setShowFar(true);
    touched.current = true;
    setSel((s) => (s.includes(sid) ? s : [sid, ...s].slice(0, 5)));
    setFlash(sid);
    window.setTimeout(() => document.getElementById(`shop-${sid}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    window.setTimeout(() => setFlash(null), 2200);
  };
  useEffect(() => {
    if (focus != null && data) reveal(focus);
  }, [focus, data?.items.length]); // eslint-disable-line

  const pickWhy = useMemo(() => Object.fromEntries(picks.map((p) => [p.sid, p.why])), [picks]);
  const cheapest = useMemo(() => {
    const priced = near.filter((i) => i.price && !i.price_warning && i.authenticity?.status !== "declared_copy");
    return priced.length > 1 ? priced.reduce((a, b) => (b.price! < a.price! ? b : a)).sid : null;
  }, [data]); // eslint-disable-line
  const hidden = Object.entries(data?.stats.hidden ?? {}).filter(([k, n]) => n > 0 && HIDDEN_LABEL[k]);
  const expand = (data?.expand ?? []).filter((e) => e.count > near.length);
  const bargain: Bargain | null | undefined = data?.bargain;
  const toggle = (sid: number) => {
    touched.current = true;
    setSel((s) => (s.includes(sid) ? s.filter((x) => x !== sid) : s.length >= 5 ? s : [...s, sid]));
  };
  // Car trips into central Tehran mostly hit the traffic zone: say it once above the list, not on every row.
  const zoneWarning = near.find((i) => i.travel.warning)?.travel.warning;
  const p = data?.product;
  const rangeLabel = data?.range?.label ?? "";

  return (
    <>
      <button className="card prodrow" onClick={onDetails} aria-label="مشخصات کالا">
        <Img src={p?.image ?? null} className="pimg sm" />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="small bold clamp2">{p?.title ?? "…"}</div>
          <div className="meta">{data?.stats.price_min ? `از ${toman(data.stats.price_min)} · ${fa(near.length)} فروشگاه نزدیک` : " "}</div>
        </div>
        <span className="linkbtn">مشخصات <Icon name="left" size={14} /></span>
      </button>

      {bargain && data && near.length === 0 ? null : agentMsg ? (
        <AiNote><span className="clamp3">{agentMsg}</span></AiNote>
      ) : (
        <AiNote title={insight?.headline} loading={!insight}><span className="clamp2">{insight?.body}</span></AiNote>
      )}

      {bargain && <BargainCard b={bargain} onOpen={() => reveal(bargain.sid)} />}

      <div className="toolbar">
        <ScrollRow className="chips nowrap" role="tablist" aria-label="مرتب‌سازی">
          {SORTS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={sort === k} className={"chip" + (sort === k ? " dark" : "")} onClick={() => setSort(k)}>{l}</button>
          ))}
        </ScrollRow>
        <button className="mapbtn iconchip" onClick={() => setView(view === "map" ? "list" : "map")} aria-pressed={view === "map"}>
          <Icon name={view === "map" ? "list" : "map"} size={18} /> {view === "map" ? "فهرست" : "نقشه"}
        </button>
      </div>

      {hidden.map(([k, n]) => (
        <div className="hintbar" key={k}>
          <Icon name="filter" size={16} />
          <span className="grow">{fa(n)} فروشگاه به خاطر {HIDDEN_LABEL[k]} پنهان شد</span>
          <button onClick={() => setCtx({ ...ctx, ...UNHIDE[k] })}>نمایش همه</button>
        </div>
      ))}

      {err && <div className="card empty">دریافت فروشگاه‌ها ناموفق بود. <button className="textbtn" onClick={() => setSort(sort === "best" ? "cheapest" : "best")}>تلاش دوباره</button></div>}
      {!data && !err && <div className="card list-skel">{[0, 1, 2].map((i) => <div key={i} className="shimmer" style={{ height: 76 }} />)}</div>}

      {data && view === "map" && (
        <Suspense fallback={<div className="shimmer mapbox" />}>
          <MapView
            you={ctx}
            pins={(near.length && !showFar ? near : items).slice(0, 40).map((i) => ({
              id: i.sid, lat: i.lat, lon: i.lon, label: i.price ? short(i.price) : "؟",
              tone: sel.includes(i.sid) ? "pick" : i.open_at_visit.state === "closed" ? "closed" : "normal",
            }))}
            onPick={(sid) => onOpenShop(sid, items.find((i) => i.sid === sid))}
          />
        </Suspense>
      )}

      {data && near.length > 0 && (
        <div className="listhead">
          <h3>{fa(near.length)} فروشگاه {rangeLabel || "نزدیک شما"}</h3>
          <span className="meta"><Icon name="info" size={13} /> قیمت ثبت‌شده در ترب؛ موجودی تا استعلام تأیید نشده</span>
          {zoneWarning && <span className="warnline"><Icon name="car" size={14} /> {zoneWarning}</span>}
        </div>
      )}

      {data && near.length === 0 && !bargain && (
        <div className="card empty">
          <img className="empty-art" src="/img/empty.webp" width={480} height={480} alt="" />
          <b>{rangeLabel ? `${rangeLabel} فروشگاهی با این کالا نیست` : "در محدودهٔ شما فروشگاهی با این کالا نیست"}</b>
          <span className="meta">محدوده را بزرگ‌تر کنید یا فروشگاه‌های دورتر را ببینید.</span>
        </div>
      )}

      {data && expand.length > 0 && near.length < 3 && (
        <div className="expand">
          <span className="meta">محدودهٔ بزرگ‌تر:</span>
          <div className="chips">
            {expand.map((e) => (
              <button key={e.label} className="chip" onClick={() => setCtx(e.minutes ? { ...ctx, range_mode: "time", range_minutes: e.minutes } : { ...ctx, range_mode: "km", radius_km: e.km ?? ctx.radius_km })}>
                {e.label} <small>{fa(e.count)} فروشگاه</small>
              </button>
            ))}
          </div>
        </div>
      )}

      {near.length > 0 && (
        <div className="card sellers">
          {near.map((i) => (
            <SellerRow key={i.sid} i={i} why={pickWhy[i.sid]} cheapest={i.sid === cheapest} flash={flash === i.sid}
              selected={sel.includes(i.sid)} onToggle={() => toggle(i.sid)} onOpen={() => onOpenShop(i.sid, i)} onOpenAlt={(sid) => onOpenShop(sid)} />
          ))}
        </div>
      )}

      {far.length > 0 && (
        <button className="morebtn" onClick={() => setShowFar(!showFar)} aria-expanded={showFar}>
          {showFar ? "پنهان کردن فروشگاه‌های دورتر" : `${fa(far.length)} فروشگاه دورتر از محدودهٔ شما`}
          <Icon name="down" size={16} style={{ transform: showFar ? "rotate(180deg)" : undefined }} />
        </button>
      )}
      {showFar && far.length > 0 && (
        <div className="card sellers">
          {far.map((i) => (
            <SellerRow key={i.sid} i={i} why={pickWhy[i.sid]} cheapest={false} flash={flash === i.sid}
              selected={sel.includes(i.sid)} onToggle={() => toggle(i.sid)} onOpen={() => onOpenShop(i.sid, i)} onOpenAlt={(sid) => onOpenShop(sid)} />
          ))}
        </div>
      )}

      {data && (data.similar.length > 0 || data.leads.length > 0) && (
        <button className="morebtn" onClick={() => setShowMore(!showMore)} aria-expanded={showMore || near.length === 0}>
          گزینه‌های دیگر: {[data.similar.length ? `${fa(data.similar.length)} کالای مشابه` : "", data.leads.length ? `${fa(data.leads.length)} فروشگاه احتمالی` : ""].filter(Boolean).join(" و ")}
          <Icon name="down" size={16} style={{ transform: showMore || near.length === 0 ? "rotate(180deg)" : undefined }} />
        </button>
      )}
      {data && (showMore || near.length === 0) && (
        <>
          {data.similar.length > 0 && (
            <div className="card sellers">
              {data.similar.map((s) => (
                <button key={s.pid} className="simrow" onClick={() => onProduct(s)}>
                  <Img src={s.image} className="pimg sm" />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="small bold clamp2">{s.title}</div>
                    <div className="meta">{s.price_min ? `از ${toman(s.price_min)} · ` : ""}{availability(s)}</div>
                  </div>
                  <Icon name="left" size={16} className="faint" />
                </button>
              ))}
            </div>
          )}
          {data.leads.length > 0 && (
            <>
              <div className="listhead"><h3>شاید این‌ها هم داشته باشند</h3><span className="meta">در همین دسته فعال‌اند ولی این کالا را ثبت نکرده‌اند؛ فقط با استعلام معلوم می‌شود.</span></div>
              <div className="card sellers">{data.leads.map((l) => <LeadRow key={l.sid} l={l} onOpen={() => onOpenShop(l.sid)} />)}</div>
            </>
          )}
        </>
      )}

      {data && items.length > 0 && (
        <div className="sticky-cta">
          <button className="btn grow" disabled={!sel.length} onClick={() => onInquiry(sel)}>
            <Icon name="chat" size={18} /> استعلام قیمت و موجودی از {fa(sel.length)} فروشگاه
          </button>
          <button className="btn ghost icon" disabled={!sel.length} onClick={() => onVisit(sel)} aria-label="برنامهٔ رفتن بدون استعلام">
            <Icon name="route" size={19} />
          </button>
        </div>
      )}
    </>
  );
}

/** Torob's in-store seller row: name and price, place and price age, travel and opening state, then badges. */
export function SellerRow({ i, why, cheapest, flash, selected, onToggle, onOpen, onOpenAlt }: {
  i: ShopOffer;
  why?: string;
  cheapest: boolean;
  flash?: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onOpenAlt?: (sid: number) => void;
}) {
  const aging = i.freshness.tier === "aging" || i.freshness.tier === "stale";
  return (
    <div id={`shop-${i.sid}`} className={"scard" + (selected ? " sel" : "") + (flash ? " flash" : "")}>
      <button className={"selbox" + (selected ? " on" : "")} onClick={onToggle} aria-pressed={selected} aria-label={`انتخاب ${i.name} برای استعلام`}>
        {selected && <Icon name="check" size={14} stroke={2.6} />}
      </button>
      <div className="scard-body">
        <button className="scard-main" onClick={onOpen}>
          <span className="r1">
            <span className="name ellipsis">{i.name}</span>
            <span className="amount">{i.price ? toman(i.price) : "بدون قیمت"}</span>
          </span>
          <span className="r2">
            <span className="ellipsis">{i.mall || i.area || i.address}</span>
            <span className={aging ? "amber-txt" : ""}>{i.freshness.days != null ? `ثبت ${fa(i.freshness.days)} روز پیش` : "زمان ثبت نامعلوم"}</span>
          </span>
          <span className="r3">
            <TravelInline t={i.travel} />
            <OpenText s={i.open_at_visit} />
            {cheapest && <span className="badge">ارزان‌ترین</span>}
            <AuthBadge a={i.authenticity} />
            {i.installments.length > 0 && <span className="tag blue">قسطی</span>}
            {i.torob_pay && <span className="tag violet">ترب‌پی</span>}
          </span>
        </button>
        {why && <div className="whyline"><Icon name="spark" size={14} stroke={1.8} /> <span className="clamp2">{why}</span></div>}
        {i.price_warning && <div className="warnline red"><Icon name="alert" size={14} /> قیمت مشکوک؛ شاید کالای دیگری باشد</div>}
        {i.alt_open && onOpenAlt && i.open_at_visit.state === "closed" && (
          <button className="altbox" onClick={() => onOpenAlt(i.alt_open!.sid)}>
            <Icon name="store" size={15} />
            <span className="grow ellipsis">جایگزین باز: <b>{i.alt_open.name}</b>{i.alt_open.same_mall ? " در همین پاساژ" : `، ${i.alt_open.distance_label}`}</span>
            <Icon name="left" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function LeadRow({ l, onOpen }: { l: ShopBrief & { reasons: string[] }; onOpen: () => void }) {
  return (
    <button className="simrow" onClick={onOpen}>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row between"><span className="bold ellipsis">{l.name}</span><span className="tag amber">تأیید نشده</span></div>
        <div className="meta ellipsis">{l.mall || l.area}</div>
        <div className="r3"><TravelInline t={l.travel} /><OpenText s={l.open_at_visit} /></div>
      </div>
    </button>
  );
}
