import { useEffect, useRef, useState } from "react";
import { api, stream } from "../../api";
import { fa, toman } from "../../fmt";
import { Icon } from "../../icons";
import type { Ctx, InquiryShop, InquirySummary, Reply } from "../../types";
import { AiNote } from "../bits";
import type { InquiryState } from "../InquiryView";
import { StepHead, WizFoot } from "./Shell";

const OUTCOME: Record<Reply["outcome"], { label: string; tone: string }> = {
  confirmed: { label: "موجوده", tone: "green" },
  price_changed: { label: "موجوده، قیمت عوض شده", tone: "amber" },
  out_of_stock: { label: "نداره", tone: "red" },
  no_answer: { label: "جواب نداد", tone: "gray" },
  closed: { label: "بسته بود", tone: "gray" },
};
const SCENARIOS: [string, string][] = [["", "خودکار"], ["confirmed", "موجود"], ["price_changed", "تغییر قیمت"], ["out_of_stock", "ناموجود"], ["no_answer", "بی‌پاسخ"]];

/** Step 6: show the message once, send it with one button, then one status line per shop and a short verdict. */
export function InquiryStep({ st, setSt, ctx, demo, toast, onBack, onGo, onRestart, onOpenShop }: {
  st: InquiryState;
  setSt: (f: (s: InquiryState) => InquiryState) => void;
  ctx: Ctx;
  demo: boolean;
  toast: (s: string) => void;
  onBack: () => void;
  onGo: (sids: number[], confirmed: Record<number, unknown>) => void;
  onRestart: (sids: number[]) => void;
  onOpenShop: (sid: number) => void;
}) {
  const [forced, setForced] = useState<Record<number, string>>({});
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<{ shops: InquiryShop[] } | null>(null);
  const [full, setFull] = useState(false);
  const ran = useRef("");
  const key = `${st.pid}:${st.sids.join(",")}`;

  useEffect(() => {
    if (st.started || ran.current === key) return;
    ran.current = key;
    setPreview(null);
    api.draft(st.pid, st.sids, ctx).then((ev) => {
      setPreview({ shops: ev.shops });
      setSt((s) => ({ ...s, product: ev.product }));
    }).catch(() => toast("آماده‌سازی پیام ناموفق بود"));
  }, [key]); // eslint-disable-line

  const start = async () => {
    setRunning(true);
    setSt((s) => ({ ...s, started: true, replies: {}, summary: null }));
    window.scrollTo({ top: 0, behavior: "smooth" });
    const f: Record<number, string> = {};
    for (const [k, v] of Object.entries(forced)) if (v) f[+k] = v;
    try {
      await stream("/api/inquiry", { pid: st.pid, sids: st.sids, ctx, forced: Object.keys(f).length ? f : null }, (ev) => {
        if (ev.type === "inquiry_start") setSt((s) => ({ ...s, shops: ev.shops, callScript: ev.call_script, notice: ev.notice, product: ev.product }));
        else if (ev.type === "reply") setSt((s) => ({ ...s, replies: { ...s.replies, [ev.sid]: ev as Reply } }));
        else if (ev.type === "summary") setSt((s) => ({ ...s, summary: ev as InquirySummary }));
        else if (ev.type === "error") toast(ev.text);
      });
    } catch {
      toast("ارتباط قطع شد؛ دوباره تلاش کنید");
    }
    setRunning(false);
  };

  const shops = st.started ? st.shops : preview?.shops ?? [];
  const sum = st.summary;
  const confirmed: Record<number, unknown> = {};
  for (const r of Object.values(st.replies)) if (r.in_stock) confirmed[r.sid] = { confirmed_price: r.confirmed_price, hold_until: r.hold_until };
  const nOk = Object.keys(confirmed).length;
  const done = st.started && !running;
  const alts = sum?.alternatives ?? [];

  const title = !st.started ? `از ${fa(st.sids.length)} فروشگاه بپرسم؟`
    : running ? "دارم می‌پرسم…" : nOk ? `${fa(nOk)} فروشگاه داره` : "هیچ‌کدوم تأیید نکرد";
  const sub = !st.started ? "این پیام رو براشون می‌فرستم و جوابشون رو همین‌جا نشونت می‌دم." : st.product?.title;

  return (
    <>
      <StepHead title={title} sub={sub} />

      {!st.started && (
        <button className="bubble-out" onClick={() => setFull(!full)} aria-expanded={full}>
          <span className={full ? "" : "clamp3"}>{preview?.shops[0]?.draft ?? "…"}</span>
        </button>
      )}

      <div className="wz-opts">
        {!shops.length && [0, 1, 2].map((i) => <div key={i} className="shimmer" style={{ height: 52 }} />)}
        {shops.map((s) => {
          const r = st.replies[s.sid];
          const o = r ? OUTCOME[r.outcome] : null;
          return (
            <div key={s.sid} className="wz-iq fadein">
              <button className="wz-iq-main" onClick={() => onOpenShop(s.sid)}>
                <span className="grow wz-opt-txt">
                  <span className="name ellipsis">{s.name}</span>
                  <span className="meta">
                    {r?.in_stock && r.confirmed_price ? <b className="green-txt">{toman(r.confirmed_price)}</b> : s.price ? toman(s.price) : "بدون قیمت"}
                    {r?.hold_until ? ` · تا ${r.hold_until} نگه می‌دارن` : ""}
                  </span>
                </span>
                {st.started && !r && <span className="typing sm"><i /><i /><i /></span>}
                {o && <span className={"tag " + o.tone}>{o.label}</span>}
              </button>
              {demo && !st.started && (
                <div className="scenario" aria-label="سناریوی دمو">
                  {SCENARIOS.map(([k, l]) => (
                    <button key={k} className={(forced[s.sid] ?? "") === k ? "on" : ""} onClick={() => setForced((f) => ({ ...f, [s.sid]: k }))}>{l}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {st.started && !sum && Object.keys(st.replies).length === shops.length && shops.length > 0 && (
        <div className="typing"><i /><i /><i /> <span>دارم جمع‌بندی می‌کنم</span></div>
      )}
      {sum && <AiNote>{sum.text}</AiNote>}
      {done && alts.length > 0 && nOk > 0 && (
        <button className="btn ghost block" onClick={() => onRestart(alts.map((a) => a.sid))}>
          <Icon name="chat" size={17} /> از {fa(alts.length)} فروشگاه دیگه هم بپرس
        </button>
      )}
      <p className="footnote"><Icon name="info" size={13} /> جواب فروشگاه‌ها در این نسخه شبیه‌سازی می‌شه، چون شماره‌های داده ساختگی‌اند.</p>

      {!st.started ? (
        <WizFoot onBack={onBack} next={{ label: <><Icon name="send" size={18} className="flip" /> بفرست</>, onClick: start, disabled: !preview || running }} />
      ) : !done ? (
        <WizFoot next={{ label: "صبر کن…", disabled: true }} />
      ) : nOk ? (
        <WizFoot onBack={onBack} next={{
          label: <><Icon name="route" size={18} /> برنامهٔ رفتن</>,
          onClick: () => onGo(sum?.confirmed_sids?.length ? sum.confirmed_sids : Object.keys(confirmed).map(Number), confirmed),
        }} />
      ) : (
        <WizFoot onBack={onBack} next={alts.length
          ? { label: <><Icon name="chat" size={18} /> از {fa(alts.length)} فروشگاه دیگه بپرس</>, onClick: () => onRestart(alts.map((a) => a.sid)) }
          : { label: <><Icon name="refresh" size={18} /> دوباره بپرس</>, onClick: () => onRestart(st.sids) }} />
      )}
    </>
  );
}
