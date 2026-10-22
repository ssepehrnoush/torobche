import { useEffect, useState, lazy, Suspense } from "react";
import { api } from "../api";
import { fa, toman } from "../fmt";
import { Icon } from "../icons";
import type { Ctx, Stroll, VisitPlan } from "../types";
import { Fold, MetroStrip, OpenText } from "./bits";
import { Img } from "./Products";
import { useNavPick } from "./NavPick";
import { Sheet } from "./Sheet";

const MapView = lazy(() => import("./MapView").then((m) => ({ default: m.MapView })));

export function VisitView({ pid, sids, confirmed, ctx, onOpenShop, toast }: {
  pid: number | null;
  sids: number[];
  confirmed: Record<number, unknown> | null;
  ctx: Ctx;
  onOpenShop: (sid: number) => void;
  toast: (s: string) => void;
}) {
  const [plan, setPlan] = useState<VisitPlan | null>(null);
  const [err, setErr] = useState(false);
  const [check, setCheck] = useState(false);
  const [stroll, setStroll] = useState<number | null>(null);
  const nav = useNavPick();
  useEffect(() => {
    setPlan(null);
    setErr(false);
    api.visit(pid, sids, ctx, confirmed).then(setPlan).catch(() => setErr(true));
  }, [pid, sids.join(","), JSON.stringify(ctx)]); // eslint-disable-line

  const share = async () => {
    if (!plan) return;
    const text = [
      `برنامهٔ خرید (${plan.start_label} تا ${plan.end_label})`,
      ...plan.stops.map((s, i) => `${fa(i + 1)}. ${s.name}، ${s.mall ?? s.address ?? ""}، رسیدن ${s.arrive_label}${s.confirmed_price ? `، قیمت تأییدشده ${toman(s.confirmed_price)}` : ""}\n${s.nav.google}`),
    ].join("\n");
    try {
      if (navigator.share) await navigator.share({ title: "برنامهٔ خرید", text });
      else {
        await navigator.clipboard.writeText(text);
        toast("برنامه کپی شد");
      }
    } catch {
      /* user cancelled */
    }
  };

  if (err) return <div className="card empty">ساخت برنامه ناموفق بود</div>;
  if (!plan) return <><div className="shimmer mapbox" /><div className="shimmer" style={{ height: 220, borderRadius: 16 }} /></>;
  const route: [number, number][] = [[plan.origin.lat, plan.origin.lon], ...plan.stops.map((s) => [s.lat, s.lon] as [number, number])];
  const first = plan.stops[0];
  const last = plan.stops[plan.stops.length - 1];
  return (
    <>
      <Suspense fallback={<div className="shimmer mapbox" />}>
        <MapView you={plan.origin} route={route} paths={plan.paths} onPick={onOpenShop}
          pins={plan.stops.map((s, i) => ({ id: s.sid, lat: s.lat, lon: s.lon, label: fa(i + 1), tone: s.open.state === "closed" ? "closed" : "pick" }))} />
      </Suspense>

      <div className="pagehead row between" style={{ alignItems: "flex-start" }}>
        <div>
          <h2>{fa(plan.stops.length)} فروشگاه، حدود {fa(plan.total_minutes)} دقیقه</h2>
          <p className="meta">حرکت از {plan.origin.label} ساعت {plan.start_label}</p>
        </div>
        <button className="textbtn" onClick={share}><Icon name="share" size={16} /> ارسال</button>
      </div>

      {plan.warnings.map((w) => (
        <div key={w} className="notice"><Icon name="alert" size={16} /> {w}</div>
      ))}

      <div className="card timeline">
        {plan.stops.map((s, i) => (
          <div className="tstop" key={s.sid}>
            <span className="tnum">{fa(i + 1)}</span>
            <div className="grow stack" style={{ gap: 4, minWidth: 0 }}>
              <div className="row between" style={{ alignItems: "baseline" }}>
                <button className="name ellipsis" onClick={() => onOpenShop(s.sid)}>{s.name}</button>
                <span className="arrive"><small>رسیدن</small> {s.arrive_label}</span>
              </div>
              {(s.mall || s.address) && <div className="meta ellipsis">{s.mall ?? s.address}</div>}
              <div className="r3">
                <OpenText s={s.open} />
                {s.confirmed_price ? <b className="green-txt">تأییدشده {toman(s.confirmed_price)}</b>
                  : s.price ? <span className="meta">ثبت‌شده {toman(s.price)}</span> : null}
              </div>
              {s.hold_until && <div className="meta blue-txt">تا {s.hold_until} برایتان نگه می‌دارند</div>}
              <div className="meta">{s.leg.label}</div>
              {s.leg.legs && s.leg.legs.length > 1 && <MetroStrip legs={s.leg.legs} />}
              {s.guide.length > 1 && <div className="meta">{s.guide.slice(1, 3).map((g) => g.text.split(" (")[0]).join("، ")}</div>}
              <div className="navbtns">
                <button className="btn ghost sm" onClick={() => nav.open(s.nav)}><Icon name="nav" size={15} /> مسیریابی{nav.appName ? ` با ${nav.appName}` : ""}</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {pid != null && last && (
        <button className="card strollcta" onClick={() => setStroll(last.sid)}>
          <span className="stroll-ico"><Icon name="walk" size={22} /></span>
          <span className="grow">
            <b>یه دور هم بزنیم؟</b>
            <span className="meta">مسیر گردش و خرید پیاده در اطراف {last.name}</span>
          </span>
          <Icon name="left" size={16} className="faint" />
        </button>
      )}

      <div className="folds">
        <Fold title="قبل از رفتن" summary={`${fa(plan.checklist.length)} نکته`} open={check} onToggle={() => setCheck(!check)}>
          <ul className="checklist">
            {plan.checklist.map((c) => <li key={c}><Icon name="check" size={15} stroke={2.2} /> <span>{c}</span></li>)}
          </ul>
        </Fold>
      </div>

      {first && (
        <div className="sticky-cta">
          <button className="btn grow" onClick={() => nav.open(first.nav)}><Icon name="nav" size={18} /> مسیریابی تا {first.name}</button>
          <button className="btn ghost icon" onClick={share} aria-label="ارسال برنامه"><Icon name="share" size={19} /></button>
        </div>
      )}

      {stroll != null && pid != null && <StrollSheet pid={pid} sid={stroll} ctx={ctx} onClose={() => setStroll(null)} onOpenShop={onOpenShop} />}
      {nav.sheet}
    </>
  );
}

/** «مسیر گردش و خرید»: a short walking loop past nearby listings priced below their usual Torob price. */
function StrollSheet({ pid, sid, ctx, onClose, onOpenShop }: { pid: number; sid: number; ctx: Ctx; onClose: () => void; onOpenShop: (sid: number) => void }) {
  const [d, setD] = useState<Stroll | null>(null);
  const [err, setErr] = useState(false);
  const nav = useNavPick();
  useEffect(() => {
    api.stroll(pid, sid, ctx).then(setD).catch(() => setErr(true));
  }, [pid, sid]); // eslint-disable-line
  const loop: [number, number][] = d?.anchor ? [[d.anchor.lat, d.anchor.lon], ...d.stops.map((s) => [s.lat, s.lon] as [number, number]), [d.anchor.lat, d.anchor.lon]] : [];
  return (
    <>
    <Sheet title="مسیر گردش و خرید" onClose={onClose}>
      {err && <div className="empty">ساخت مسیر گردش ناموفق بود</div>}
      {!d && !err && <div className="shimmer" style={{ height: 260, borderRadius: 16 }} />}
      {d && !d.stops.length && <div className="card empty">{d.note}</div>}
      {d && d.stops.length > 0 && d.anchor && (
        <>
          <AiSummary text={d.summary ?? ""} />
          <Suspense fallback={<div className="shimmer mapbox" />}>
            <MapView you={{ lat: d.anchor.lat, lon: d.anchor.lon }} route={loop} small onPick={onOpenShop}
              pins={d.stops.map((s, i) => ({ id: s.sid, lat: s.lat, lon: s.lon, label: fa(i + 1), tone: "pick" }))} />
          </Suspense>
          <div className="card sellers">
            {d.stops.map((s, i) => (
              <div key={s.sid} className="strollrow">
                <span className="tnum sm">{fa(i + 1)}</span>
                <Img src={s.item.image} className="pimg sm" />
                <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                  <div className="small bold clamp2">{s.item.title}</div>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <b className="small">{toman(s.item.price)}</b>
                    <span className="tag green">{s.item.label}</span>
                  </div>
                  <button className="meta ellipsis textlink" onClick={() => onOpenShop(s.sid)}>{s.name}، {s.mall}</button>
                  <div className="row between">
                    <span className="meta"><Icon name="walk" size={13} /> {fa(s.walk_minutes)} دقیقه پیاده از توقف قبلی</span>
                    <button className="textbtn" onClick={() => nav.open(s.nav)}>مسیریابی</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="footnote"><Icon name="info" size={13} /> {d.note}</p>
        </>
      )}
    </Sheet>
    {nav.sheet}
    </>
  );
}

function AiSummary({ text }: { text: string }) {
  return (
    <div className="ainote">
      <span className="ai-dot"><Icon name="walk" size={15} stroke={1.8} /></span>
      <div className="ainote-body">{text}</div>
    </div>
  );
}
