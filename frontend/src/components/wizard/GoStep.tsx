import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "../../api";
import { fa, HERE, shortPlace, toman } from "../../fmt";
import { Icon } from "../../icons";
import type { Ctx, VisitPlan } from "../../types";
import { left, useNow } from "../../useNow";
import { useNavPick } from "../NavPick";
import { StepHead, WizFoot } from "./Shell";

const MapView = lazy(() => import("../MapView").then((m) => ({ default: m.MapView })));

/** The shop keeps the item: the code to show at the counter and how long is left, ticking. Red when the
    hold ends before the planned arrival. */
function Hold({ code, until, at, arrive }: { code: string; until: string; at: string; arrive: string }) {
  const now = useNow();
  const rest = left(at, now);
  const late = new Date(arrive).getTime() > new Date(at).getTime();
  return (
    <div className={"wz-hold" + (!rest || late ? " late" : "")}>
      <Icon name="tag" size={16} />
      <span className="grow">کد رزرو <b className="wz-code">{fa(code)}</b> · تا {until}</span>
      <span className="tnum-txt">{rest ? `${rest} مانده` : "تمام شد"}</span>
    </div>
  );
}

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
  const nav = useNavPick();
  useEffect(() => {
    setPlan(null);
    setErr(false);
    api.visit(pid, sids, ctx, confirmed).then(setPlan).catch(() => setErr(true));
  }, [pid, sids.join(","), JSON.stringify(ctx), tries]); // eslint-disable-line

  const share = async () => {
    if (!plan) return;
    const text = [
      `برنامهٔ خرید (${plan.start_label} تا ${plan.end_label})`,
      ...plan.stops.map((s, i) => `${fa(i + 1)}. ${s.name}، ${s.mall ?? s.address ?? ""}، رسیدن ${s.arrive_label}${s.confirmed_price ? `، قیمت تأییدشده ${toman(s.confirmed_price)}` : ""}`
        + `${s.hold_code ? `، کد رزرو ${fa(s.hold_code)} (تا ${s.hold_until})` : ""}\n${s.nav.google}`),
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
        <MapView you={plan.origin} route={route} paths={plan.paths} small allPins onPick={onOpenShop}
          youLabel={plan.origin.label === HERE ? "شما اینجایید" : `شروع: ${shortPlace(plan.origin.label)}`}
          pins={plan.stops.map((s, i) => ({ id: s.sid, lat: s.lat, lon: s.lon, label: fa(i + 1), tone: s.open.state === "closed" ? "closed" : "pick" }))} />
      </Suspense>

      {plan.warnings.length > 0 && (
        <div className="notice"><Icon name="alert" size={16} /><span>{plan.warnings.map((w) => <span key={w} className="wz-warn">{w}</span>)}</span></div>
      )}

      <div className="wz-opts">
        {plan.stops.map((s, i) => (
          <div key={s.sid} className="wz-stop">
            <div className="wz-stop-row">
              <span className="tnum sm">{fa(i + 1)}</span>
              <button className="grow wz-opt-txt" onClick={() => onOpenShop(s.sid)}>
                <span className="name ellipsis">{s.name}</span>
                <span className="meta">
                  رسیدن {s.arrive_label}
                  {s.confirmed_price ? <> · <b className="green-txt">{toman(s.confirmed_price)}</b></> : s.price ? ` · ${toman(s.price)}` : ""}
                </span>
              </button>
              <button className="btn ghost sm" onClick={() => nav.open(s.nav)}><Icon name="nav" size={15} /> مسیر</button>
            </div>
            {s.hold_code && s.hold_until_at && <Hold code={s.hold_code} until={s.hold_until ?? ""} at={s.hold_until_at} arrive={s.arrive} />}
          </div>
        ))}
      </div>

      {first && (
        <WizFoot onBack={onBack} next={{ label: <><Icon name="nav" size={18} /> مسیریابی تا {first.name}</>, onClick: () => nav.open(first.nav) }}
          extra={<button className="btn ghost icon" onClick={share} aria-label="ارسال برنامه"><Icon name="share" size={19} /></button>} />
      )}
    </>
  );
}
