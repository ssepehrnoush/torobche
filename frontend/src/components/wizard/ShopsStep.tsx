import { useEffect, useState } from "react";
import { api } from "../../api";
import { fa, toman } from "../../fmt";
import { Icon } from "../../icons";
import type { Authenticity, Ctx, ShopOffer, ShopsResult } from "../../types";
import { activeFilters } from "../ContextBar";
import { AuthBadge, OpenText, TravelInline } from "../bits";
import { Img } from "../Products";
import { StepHead, WizFoot } from "./Shell";

const FIRST = 5; // rows shown before «بیشتر»
const MAX_SEL = 5;

/** Step 5: a short list of nearby shops, the best three already ticked. Everything else waits behind one button. */
export function ShopsStep({ pid, ctx, setCtx, picks, onBack, onAsk, onGo, onOpenShop, onDetails }: {
  pid: number;
  ctx: Ctx;
  setCtx: (c: Ctx) => void;
  picks: { sid: number; why: string }[];
  onBack: () => void;
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
  const ctxKey = JSON.stringify(ctx);

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
  const cheapest = near.filter((i) => i.price && !i.price_warning && i.authenticity?.status !== "declared_copy")
    .reduce<ShopOffer | null>((a, b) => (!a || b.price! < a.price! ? b : a), null)?.sid;
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
      <StepHead title="از کدوم فروشگاه‌ها بپرسیم؟"
        sub={!data ? " " : near.length ? `${fa(near.length)} فروشگاه ${range} این کالا رو دارن. بهترین‌ها رو انتخاب کردم؛ اگه خواستی عوضشون کن.` : undefined} />

      <button className="wz-prodline" onClick={onDetails} aria-label="مشخصات کالا">
        <Img src={p?.image ?? null} className="pimg xs" />
        <span className="grow ellipsis">{p?.title ?? "…"}</span>
        <span className="linkbtn">مشخصات</span>
      </button>

      {err && <div className="card empty">دریافت فروشگاه‌ها ناموفق بود. <button className="textbtn" onClick={() => setTries(tries + 1)}>تلاش دوباره</button></div>}
      {!data && !err && <div className="card list-skel">{[0, 1, 2].map((i) => <div key={i} className="shimmer" style={{ height: 60 }} />)}</div>}

      {data && near.length === 0 && (
        <div className="card empty">
          <img className="empty-art" src="/img/empty.webp" width={480} height={480} alt="" />
          <b>{range} فروشگاهی این کالا رو نداره</b>
          <span className="meta">محدوده رو بزرگ‌تر کن{activeFilters(ctx) ? " یا شرط‌ها رو بردار" : ""}.</span>
          <div className="chips center" style={{ marginTop: 8 }}>
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
          <span className="r3"><TravelInline t={i.travel} /><OpenText s={i.open_at_visit} />{tag}</span>
        </span>
      </button>
      <button className="wz-info" onClick={onInfo} aria-label={`جزئیات ${i.name}`}><Icon name="info" size={18} /></button>
    </div>
  );
}
