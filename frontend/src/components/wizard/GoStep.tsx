import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "../../api";
import { fa, toman } from "../../fmt";
import { Icon } from "../../icons";
import type { Ctx, VisitPlan } from "../../types";
import { StepHead, WizFoot } from "./Shell";

const MapView = lazy(() => import("../MapView").then((m) => ({ default: m.MapView })));

/** Last step: where to go, in what order, when you get there. One button opens the navigation app. */
export function GoStep({ pid, sids, confirmed, ctx, toast, onBack, onOpenShop }: {
  pid: number | null;
  sids: number[];
  confirmed: Record<number, unknown> | null;
  ctx: Ctx;
  toast: (s: string) => void;
  onBack: () => void;
  onOpenShop: (sid: number) => void;
}) {
  const [plan, setPlan] = useState<VisitPlan | null>(null);
  const [err, setErr] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    setPlan(null);
    setErr(false);
    api.visit(pid, sids, ctx, confirmed).then(setPlan).catch(() => setErr(true));
  }, [pid, sids.join(","), JSON.stringify(ctx), tries]); // eslint-disable-line

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

  if (err) return <><StepHead title="ساخت برنامه ناموفق بود" /><WizFoot onBack={onBack} next={{ label: "دوباره", onClick: () => setTries(tries + 1) }} /></>;
  if (!plan) {
    return (
      <>
        <StepHead title="دارم مسیر رو می‌چینم…" />
        <div className="shimmer mapbox small" />
        <WizFoot onBack={onBack} next={{ label: "صبر کن…", disabled: true }} />
      </>
    );
  }
  const route: [number, number][] = [[plan.origin.lat, plan.origin.lon], ...plan.stops.map((s) => [s.lat, s.lon] as [number, number])];
  const first = plan.stops[0];
  return (
    <>
      <StepHead title={<>آماده‌ای! <Icon name="check" size={22} stroke={2.4} className="green-txt" /></>}
        sub={`${fa(plan.stops.length)} فروشگاه، حدود ${fa(plan.total_minutes)} دقیقه. حرکت از ${plan.origin.label} ساعت ${plan.start_label}.`} />

      <Suspense fallback={<div className="shimmer mapbox small" />}>
        <MapView you={plan.origin} route={route} small onPick={onOpenShop}
          pins={plan.stops.map((s, i) => ({ id: s.sid, lat: s.lat, lon: s.lon, label: fa(i + 1), tone: s.open.state === "closed" ? "closed" : "pick" }))} />
      </Suspense>

      {plan.warnings.length > 0 && (
        <div className="notice"><Icon name="alert" size={16} /><span>{plan.warnings.map((w) => <span key={w} className="wz-warn">{w}</span>)}</span></div>
      )}

      <div className="wz-opts">
        {plan.stops.map((s, i) => (
          <div key={s.sid} className="wz-stop">
            <span className="tnum sm">{fa(i + 1)}</span>
            <button className="grow wz-opt-txt" onClick={() => onOpenShop(s.sid)}>
              <span className="name ellipsis">{s.name}</span>
              <span className="meta">
                رسیدن {s.arrive_label}
                {s.confirmed_price ? <> · <b className="green-txt">{toman(s.confirmed_price)}</b></> : s.price ? ` · ${toman(s.price)}` : ""}
              </span>
            </button>
            <a className="btn ghost sm" href={s.nav.neshan} target="_blank" rel="noreferrer"><Icon name="nav" size={15} /> مسیر</a>
          </div>
        ))}
      </div>

      {first && (
        <WizFoot onBack={onBack} next={{ label: <><Icon name="nav" size={18} /> مسیریابی تا {first.name}</>, href: first.nav.neshan }}
          extra={<button className="btn ghost icon" onClick={share} aria-label="ارسال برنامه"><Icon name="share" size={19} /></button>} />
      )}
    </>
  );
}
