import { useState } from "react";
import { Icon } from "../icons";
import { fa, HERE, parseToman, short, shortPlace } from "../fmt";
import type { Ctx, Meta, TravelMode } from "../types";
import { MODE_ICON } from "./bits";
import { Sheet } from "./Sheet";

const BUDGETS = [5_000_000, 20_000_000, 50_000_000, 100_000_000, 200_000_000];
const FERDOWSI = { lat: 35.6998, lon: 51.4197 };
const MODES: Record<TravelMode, string> = { walk: "پیاده", car: "با ماشین", transit: "با مترو و اتوبوس" };
const PRESETS = [10, 20, 30, 45, 60];

export function activeFilters(ctx: Ctx): number {
  return (ctx.visit !== "now" ? 1 : 0) + (ctx.budget_max || ctx.budget_min ? 1 : 0) + (ctx.installments_only ? 1 : 0) +
    (ctx.open_only ? 1 : 0) + (ctx.torob_pay_only ? 1 : 0) + (ctx.originality === "original_only" ? 1 : 0);
}

/** The budget in a few words: «۵ تا ۲۰ میلیون», «تا ۲۰ میلیون», «از ۵ میلیون»; empty when there is none. */
export function budgetText(c: Pick<Ctx, "budget_min" | "budget_max">): string {
  if (c.budget_min && c.budget_max) return `${short(c.budget_min)} تا ${short(c.budget_max)}`;
  if (c.budget_max) return `تا ${short(c.budget_max)}`;
  if (c.budget_min) return `از ${short(c.budget_min)}`;
  return "";
}

export function rangeText(ctx: Ctx): string {
  return ctx.range_mode === "km" ? `${fa(ctx.radius_km)} کیلومتر` : `${fa(ctx.range_minutes)} دقیقه`;
}

/** What the assistant changed in this turn, as short chip labels («تا ۲۰۰ میلیون», «فقط قسطی»). */
export function ctxChanges(a: Ctx, b: Ctx, meta: Meta | null): string[] {
  const out: string[] = [];
  if (b.place !== a.place) out.push(`از ${shortPlace(b.place)}`);
  if (b.travel_mode !== a.travel_mode) out.push(MODES[b.travel_mode]);
  if (b.range_mode !== a.range_mode || b.range_minutes !== a.range_minutes || b.radius_km !== a.radius_km) out.push(`تا ${rangeText(b)}`);
  if ((b.budget_max !== a.budget_max || b.budget_min !== a.budget_min) && budgetText(b)) out.push(budgetText(b));
  if ((b.budget_max !== a.budget_max || b.budget_min !== a.budget_min) && !budgetText(b)) out.push("بدون محدودیت بودجه");
  if (b.installments_only !== a.installments_only) out.push(b.installments_only ? "فقط قسطی" : "قسطی و نقدی");
  if (b.originality !== a.originality) out.push(b.originality === "original_only" ? "فقط کالای اصل" : "اصل و غیراصل");
  if (b.open_only !== a.open_only && b.open_only) out.push("فقط باز");
  if (b.torob_pay_only !== a.torob_pay_only && b.torob_pay_only) out.push("فقط ترب‌پی");
  if (b.visit !== a.visit) out.push(meta?.visit_presets?.[b.visit] ?? b.visit);
  return out;
}

/** Header chip, read as one phrase: «از فردوسی / تا ۲۰ دقیقه», with the travel mode as its icon. */
export function PlaceChip({ ctx, onOpen }: { ctx: Ctx; onOpen: () => void }) {
  return (
    <button className="placechip" onClick={onOpen} aria-label={`از ${shortPlace(ctx.place)} تا ${rangeText(ctx)}؛ تغییر محل، نوع رفت‌وآمد و محدوده`}>
      <Icon name={MODE_ICON[ctx.travel_mode] ?? "pin"} size={18} />
      <span className="pc-txt">
        <b className="ellipsis">از {shortPlace(ctx.place)}</b>
        <small>تا {rangeText(ctx)}</small>
      </span>
    </button>
  );
}

export function RouteSheet({ ctx, setCtx, meta, toast, onClose }: { ctx: Ctx; setCtx: (c: Ctx) => void; meta: Meta | null; toast: (s: string) => void; onClose: () => void }) {
  const [allPlaces, setAllPlaces] = useState(false);
  const places = meta?.places ?? [];
  const modes = (meta?.travel_modes ?? MODES) as Record<TravelMode, string>;
  const presets = meta?.range_minutes_presets ?? PRESETS;
  const shown = allPlaces ? places : places.filter((p, i) => i < 5 || p.label === ctx.place);
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
    <Sheet title="از کجا و چطور می‌روید؟" onClose={onClose} footer={<button className="btn block" onClick={onClose}>نمایش نتیجه</button>}>
      <section className="sec">
        <h3>چطور می‌روید؟</h3>
        <div className="segmented three">
          {(Object.keys(modes) as TravelMode[]).map((m) => (
            <button key={m} className={ctx.travel_mode === m ? "on" : ""} onClick={() => setCtx({ ...ctx, travel_mode: m })}>
              <Icon name={MODE_ICON[m]} size={18} />
              {modes[m]}
            </button>
          ))}
        </div>
      </section>

      <section className="sec">
        <h3>تا چقدر راه؟</h3>
        {ctx.range_mode === "time" ? (
          <div className="chips">
            {presets.map((m) => (
              <button key={m} className={"chip" + (ctx.range_minutes === m ? " on" : "")} onClick={() => setCtx({ ...ctx, range_mode: "time", range_minutes: m })}>
                {fa(m)} دقیقه
              </button>
            ))}
          </div>
        ) : (
          <div className="stack" style={{ gap: 4 }}>
            <div className="row between"><span className="meta">فاصلهٔ مستقیم</span><b className="blue-txt">{fa(ctx.radius_km)} کیلومتر</b></div>
            <input className="range" type="range" min={1} max={20} step={1} value={ctx.radius_km} aria-label="شعاع به کیلومتر"
              onChange={(e) => setCtx({ ...ctx, radius_km: +e.target.value })} />
          </div>
        )}
        <button className="textbtn" onClick={() => setCtx({ ...ctx, range_mode: ctx.range_mode === "time" ? "km" : "time" })}>
          {ctx.range_mode === "time" ? "به‌جای زمان، با کیلومتر" : "با زمان رسیدن"}
        </button>
      </section>

      <section className="sec">
        <h3>از کجا؟</h3>
        <div className="list">
          <button className="li" onClick={locate}>
            <Icon name="locate" size={18} />
            <span className="grow stack" style={{ gap: 0 }}>
              <span>از اینجا</span>
              <span className="meta" style={{ fontWeight: 400 }}>با موقعیت‌یاب گوشی</span>
            </span>
            {shortPlace(ctx.place) === HERE && <Icon name="check" size={18} className="blue-txt" />}
          </button>
          {shown.map((p) => (
            <button key={p.id} className={"li" + (ctx.place === p.label ? " on" : "")}
              onClick={() => setCtx({ ...ctx, lat: p.lat, lon: p.lon, place: p.label })}>
              <Icon name="pin" size={18} />
              <span className="grow">{p.label}</span>
              {ctx.place === p.label && <Icon name="check" size={18} />}
            </button>
          ))}
          {!allPlaces && places.length > shown.length && (
            <button className="li more" onClick={() => setAllPlaces(true)}>
              <span className="grow">{fa(places.length - shown.length)} محلهٔ دیگر</span>
              <Icon name="down" size={16} />
            </button>
          )}
        </div>
      </section>
    </Sheet>
  );
}

/** Filter icon in the header with a count; opens everything that narrows results. */
export function FiltersButton({ ctx, onOpen }: { ctx: Ctx; onOpen: () => void }) {
  const n = activeFilters(ctx);
  return (
    <button className={"iconbtn" + (n ? " on" : "")} onClick={onOpen} aria-label={n ? `فیلترها، ${fa(n)} فعال` : "فیلترها"}>
      <Icon name="filter" size={21} />
      {n > 0 && <i className="count">{fa(n)}</i>}
    </button>
  );
}

export function FiltersSheet({ ctx, setCtx, meta, onClose }: { ctx: Ctx; setCtx: (c: Ctx) => void; meta: Meta | null; onClose: () => void }) {
  const [lo, setLo] = useState("");
  const [hi, setHi] = useState("");
  const amount = (s: string) => { const v = parseToman(s); return v ? (v < 1000 ? v * 1_000_000 : v) : null; };
  const toggle = (k: "installments_only" | "open_only" | "torob_pay_only") => setCtx({ ...ctx, [k]: !ctx[k] });
  return (
    <Sheet title="فیلترها" onClose={onClose}
      actions={activeFilters(ctx) ? (
        <button className="textbtn" onClick={() => setCtx({ ...ctx, visit: "now", budget_max: null, budget_min: null, installments_only: false, open_only: false, torob_pay_only: false, originality: "any" })}>
          حذف همه
        </button>
      ) : undefined}
      footer={<button className="btn block" onClick={onClose}>نمایش نتیجه</button>}>
      <section className="sec">
        <h3>کی می‌روید؟</h3>
        <div className="chips">
          {Object.entries(meta?.visit_presets ?? { now: "همین الان" }).map(([k, label]) => (
            <button key={k} className={"chip" + (ctx.visit === k ? " on" : "")} onClick={() => setCtx({ ...ctx, visit: k })}>{label}</button>
          ))}
        </div>
        <p className="meta" style={{ margin: 0 }}>باز بودن هر فروشگاه برای همان زمانی که می‌رسید حساب می‌شود.</p>
      </section>

      <section className="sec">
        <h3>بودجه</h3>
        <div className="chips">
          <button className={"chip" + (!budgetText(ctx) ? " on" : "")} onClick={() => setCtx({ ...ctx, budget_max: null, budget_min: null })}>همهٔ قیمت‌ها</button>
          {BUDGETS.map((b) => (
            <button key={b} className={"chip" + (ctx.budget_max === b && !ctx.budget_min ? " on" : "")} onClick={() => setCtx({ ...ctx, budget_max: b, budget_min: null })}>
              تا {short(b)}
            </button>
          ))}
        </div>
        <form className="row budget-range" onSubmit={(e) => {
          e.preventDefault();
          let a = amount(lo), b = amount(hi);
          if (a && b && a > b) [a, b] = [b, a];
          if (a || b) setCtx({ ...ctx, budget_min: a, budget_max: b });
        }}>
          <label className="budget-end"><span>از</span><input className="input" inputMode="numeric" placeholder="مثلاً ۵ میلیون" value={lo} onChange={(e) => setLo(e.target.value)} aria-label="کمترین قیمت" /></label>
          <label className="budget-end"><span>تا</span><input className="input" inputMode="numeric" placeholder="مثلاً ۱۵ میلیون" value={hi} onChange={(e) => setHi(e.target.value)} aria-label="بیشترین قیمت" /></label>
          <button className="btn ghost sm" type="submit">ثبت</button>
        </form>
        {budgetText(ctx) && <p className="meta" style={{ margin: 0 }}>الان: {budgetText(ctx)} تومان</p>}
      </section>

      <div className="list">
        <Toggle on={ctx.installments_only} onClick={() => toggle("installments_only")} title="فقط خرید قسطی" sub="ترب‌پی، اسنپ‌پی، دیجی‌پی، تارا یا ازکی‌وام" />
        <Toggle on={ctx.originality === "original_only"} onClick={() => setCtx({ ...ctx, originality: ctx.originality === "original_only" ? "any" : "original_only" })}
          title="فقط کالای اصل" sub="فروشنده‌هایی که خودشان غیراصل نوشته‌اند یا قیمتشان مشکوک است پنهان می‌شوند" />
        <Toggle on={ctx.open_only} onClick={() => toggle("open_only")} title="فقط فروشگاه‌های باز" sub="در زمانی که می‌رسید" />
        <Toggle on={ctx.torob_pay_only} onClick={() => toggle("torob_pay_only")} title="فقط ترب‌پی" />
      </div>
    </Sheet>
  );
}

function Toggle({ on, onClick, title, sub }: { on: boolean; onClick: () => void; title: string; sub?: string }) {
  return (
    <button className="li" onClick={onClick} role="switch" aria-checked={on}>
      <span className="grow stack" style={{ gap: 0 }}>
        <span>{title}</span>
        {sub && <span className="meta" style={{ fontWeight: 400 }}>{sub}</span>}
      </span>
      <span className={"switch" + (on ? " on" : "")}><i /></span>
    </button>
  );
}
