import { useEffect, useRef, useState } from "react";
import { api, stream } from "../../api";
import { fa, toman } from "../../fmt";
import { Icon } from "../../icons";
import { askToNotify, notify } from "../../notify";
import type { Ctx, InquiryShop, InquirySummary, Reply } from "../../types";
import { AiNote } from "../bits";
import type { InquiryState } from "../InquiryView";
import { StepHead, WizFoot } from "./Shell";
import { ReachShow } from "./ReachShow";
import { ShopLinkSheet } from "./ShopLink";

const OUTCOME: Record<Reply["outcome"], { label: string; tone: string }> = {
  confirmed: { label: "موجوده", tone: "green" },
  price_changed: { label: "موجوده، قیمت عوض شده", tone: "amber" },
  out_of_stock: { label: "نداره", tone: "red" },
  no_answer: { label: "جواب نداد", tone: "gray" },
  closed: { label: "بسته بود", tone: "gray" },
};
const SCENARIOS: [string, string][] = [["", "خودکار"], ["live", "زنده"], ["confirmed", "موجود"], ["price_changed", "تغییر قیمت"], ["out_of_stock", "ناموجود"], ["no_answer", "بی‌پاسخ"], ["on_call", "با تماس"]];
const VIA: Record<string, string> = { whatsapp: "واتساپ", sms: "پیامک", call: "تماس هوش مصنوعی" };
const CHAN_ICON: Record<string, string> = { whatsapp: "chat", sms: "chat", bale: "send", call: "phone" };
type Chan = { channel: string; label: string; state: "sent" | "calling" | "no_answer"; real?: boolean };

/* A tester can play the first shop on their own phone; the number is remembered on this device only. */
const TESTER_KEY = "torobche.testerPhone";
const digits = (s: string) => s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/\D/g, "");
const isMobile = (s: string) => /^(0098|98|0)?9\d{9}$/.test(digits(s));

/** The one line a shop's thread shows while it is being asked: the way being tried now. */
function ChanNow({ log, replied }: { log: Chan[]; replied: boolean }) {
  const c = log[log.length - 1];
  if (!c || replied) return null;
  const text = c.state === "no_answer" ? `${c.label} جواب نداد، راه بعدی…` : c.channel === "call" ? "هوش مصنوعی داره زنگ می‌زنه…" : `${c.label} رفت، منتظر جواب`;
  return (
    <div className={"wz-sys" + (c.channel === "call" && c.state === "calling" ? " ringing" : "")}>
      <Icon name={CHAN_ICON[c.channel] ?? "chat"} size={13} />
      <span>{text}{c.real ? " (واقعی)" : ""}</span>
    </div>
  );
}

/** Step 6: show the message once, send it with one button, then each shop as a short chat thread: the
    channels tried in its own order, live, and its answer as a bubble; a phone notification when one lands. */
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
  const [log, setLog] = useState<Record<number, Chan[]>>({});
  const [link, setLink] = useState<InquiryShop | null>(null);
  const [tester, setTester] = useState(() => {
    try {
      return localStorage.getItem(TESTER_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [play, setPlay] = useState(false);
  const [reach, setReach] = useState(false);
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
    askToNotify(); // asked on this tap, since the answers often land while the person is in another app
    setReach(true);
    setRunning(true);
    setSt((s) => ({ ...s, started: true, replies: {}, summary: null }));
    setLog({});
    window.scrollTo({ top: 0, behavior: "smooth" });
    const f: Record<number, string> = {};
    for (const [k, v] of Object.entries(forced)) if (v) f[+k] = v;
    const names: Record<number, string> = {};
    const tester_phone = play && isMobile(tester) ? tester : null;
    if (tester_phone) {
      try {
        localStorage.setItem(TESTER_KEY, tester_phone);
      } catch {
        /* not remembered, asked again next time */
      }
    }
    try {
      await stream("/api/inquiry", { pid: st.pid, sids: st.sids, ctx, forced: Object.keys(f).length ? f : null, tester_phone }, (ev) => {
        if (ev.type === "inquiry_start") {
          for (const s of ev.shops as InquiryShop[]) names[s.sid] = s.name;
          setSt((s) => ({ ...s, shops: ev.shops, callScript: ev.call_script, notice: ev.notice, product: ev.product }));
          // demo «زنده» without a real text: the QR is up at once, for the second phone
          const live = (ev.shops as InquiryShop[]).find((x) => f[x.sid] === "live" && !x.real);
          if (live) setLink(live);
        } else if (ev.type === "channel") {
          const c: Chan = { channel: ev.channel, label: ev.label, state: ev.state, real: ev.real };
          setLog((l) => {
            const prev = l[ev.sid] ?? [];
            // «no answer» closes the channel's own line instead of adding one more
            const last = prev[prev.length - 1];
            const rest = c.state === "no_answer" && last?.channel === c.channel ? prev.slice(0, -1) : prev;
            return { ...l, [ev.sid]: [...rest, c] };
          });
        } else if (ev.type === "reply") {
          const r = ev as Reply;
          setSt((s) => ({ ...s, replies: { ...s.replies, [r.sid]: r } }));
          const price = r.in_stock && r.confirmed_price ? ` · ${toman(r.confirmed_price)}` : "";
          notify(`جواب ${names[r.sid] ?? "فروشگاه"}`, `${OUTCOME[r.outcome].label}${price}`);
        } else if (ev.type === "summary") setSt((s) => ({ ...s, summary: ev as InquirySummary }));
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
  for (const r of Object.values(st.replies)) {
    if (r.in_stock) confirmed[r.sid] = { confirmed_price: r.confirmed_price, hold_until: r.hold_until, hold_until_at: r.hold_until_at, hold_code: r.hold_code };
  }
  const nOk = Object.keys(confirmed).length;
  const nIn = Object.keys(st.replies).length;
  const done = st.started && !running;
  const alts = sum?.alternatives ?? [];

  const title = !st.started ? `از ${fa(st.sids.length)} فروشگاه بپرسم؟`
    : running ? "دارم می‌پرسم…" : nOk ? `${fa(nOk)} فروشگاه داره` : "هیچ‌کدوم تأیید نکرد";
  const sub = !st.started ? "این پیام رو براشون می‌فرستم و جوابشون رو همین‌جا نشونت می‌دم." : st.product?.title;

  return (
    <>
      <StepHead title={title} sub={sub} />

      {!st.started ? (
        <button className="bubble-out" onClick={() => setFull(!full)} aria-expanded={full}>
          <span className={full ? "" : "clamp3"}>{preview?.shops[0]?.draft ?? "…"}</span>
        </button>
      ) : shops.length > 0 && (
        <div className="wz-tally" role="status">
          <span>{fa(nIn)} از {fa(shops.length)} فروشگاه جواب دادن</span>
          <i style={{ width: `${(nIn / shops.length) * 100}%` }} />
        </div>
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
                  </span>
                </span>
                {o && <span className={"tag " + o.tone}>{o.label}</span>}
              </button>

              {!st.started ? (
                s.channels?.length ? (
                  <div className="wz-iq-ch"><Icon name="chat" size={13} />
                    <span className="grow">راه‌هایی که خودش خواسته: {s.channels.map((x) => x.label).join("، بعد ")}</span>
                  </div>
                ) : null
              ) : (
                <div className="wz-thread">
                  <ChanNow log={log[s.sid] ?? []} replied={!!r} />
                  {!r && <span className="typing sm"><i /><i /><i /></span>}
                  {r && (r.text || r.note) && (
                    <div className={"wz-in" + (r.in_stock === false || !r.text ? " off" : "")}>
                      <span>{r.text ?? r.note}</span>
                      <span className="wz-in-meta">
                        {r.via ? `از راه ${VIA[r.via] ?? r.via}` : ""}{r.real ? " · با یک لمس روی صفحهٔ جواب" : ""}
                      </span>
                    </div>
                  )}
                  {r?.hold_code && (
                    <div className="wz-hold"><Icon name="tag" size={16} />
                      <span className="grow">کد رزرو <b className="wz-code">{fa(r.hold_code)}</b> · تا {r.hold_until} نگه می‌دارن</span>
                    </div>
                  )}
                  {s.reply_token && (
                    <button className="textbtn wz-shoplink" onClick={() => setLink(s)}>صفحهٔ مغازه‌دار</button>
                  )}
                </div>
              )}

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

      {!st.started && shops.length > 0 && (
        <div className={"wz-tester" + (play ? " on" : "")}>
          <button className="wz-tester-head" onClick={() => setPlay(!play)} role="checkbox" aria-checked={play}>
            <span className="wz-opt-ico"><Icon name="mobile" size={20} /></span>
            <span className="grow wz-opt-txt">
              <span className="wz-opt-t">خودت جای مغازه‌دار جواب بده</span>
              <span className="meta">پیام «{shops[0].name}» واقعاً به گوشیت می‌آد</span>
            </span>
            <span className={"selbox" + (play ? " on" : "")}>{play && <Icon name="check" size={14} stroke={2.6} />}</span>
          </button>
          {play && (
            <div className="wz-tester-body fadein">
              <input value={tester} onChange={(e) => setTester(e.target.value)} inputMode="tel" dir="ltr" autoComplete="tel"
                placeholder="0912 345 6789" aria-label="شماره موبایل خودت" />
              {tester.trim() && !isMobile(tester) && <span className="red-txt small">این شمارهٔ موبایل ایران نیست</span>}
              <p className="meta">
                یه پیام واتساپ و یه پیامک با لینک جواب، و اگه جواب ندادی یه تماس خودکار از طرف «هوش مصنوعی لمون» به این شماره می‌آد.
                شماره فقط برای همین استعلام استفاده می‌شه و هر شماره روزی حداکثر دو بار.
              </p>
            </div>
          )}
        </div>
      )}

      {st.started && !sum && nIn === shops.length && shops.length > 0 && (
        <div className="typing"><i /><i /><i /> <span>دارم جمع‌بندی می‌کنم</span></div>
      )}
      {sum && <AiNote>{sum.text}</AiNote>}
      {done && alts.length > 0 && nOk > 0 && (
        <button className="btn ghost block" onClick={() => onRestart(alts.map((a) => a.sid))}>
          <Icon name="chat" size={17} /> از {fa(alts.length)} فروشگاه دیگه هم بپرس
        </button>
      )}
      <p className="footnote"><Icon name="info" size={13} /> هر مغازه خودش گفته از چه راهی و به چه ترتیبی بپرسیم. جواب‌ها شبیه‌سازی می‌شن چون شماره‌های داده ساختگی‌اند، ولی صفحهٔ جواب مغازه‌دار واقعیه.</p>

      {!st.started ? (
        <WizFoot onBack={onBack} next={{ label: <><Icon name="send" size={18} className="flip" /> بفرست</>, onClick: start,
          disabled: !preview || running || (play && !isMobile(tester)) }} />
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
      {link && <ShopLinkSheet shop={link} onClose={() => setLink(null)} toast={toast} />}
      {reach && shops.length > 0 && (() => {
        // the demo shows all three ways; a real person sees the first way the first shop picked
        const first = shops[0];
        const ways = (demo ? ["call", "whatsapp", "sms"] : [first.channels?.[0]?.k ?? "sms"])
          .filter((w): w is "call" | "whatsapp" | "sms" => w === "call" || w === "whatsapp" || w === "sms");
        const msg = first.sms ? first.sms.replace("/r/", "torobche.lemonai.ir/r/")
          : `فروشگاه ${first.name}\nیک مشتری نزدیک شما این کالا را می‌خواهد: ${st.product?.title ?? ""}\nموجود دارید؟ جواب با یک لمس:\ntorobche.lemonai.ir/r/…\nهوش مصنوعی لمون`;
        return <ReachShow ways={ways.length ? ways : ["sms"]} shop={first.name} message={msg} onDone={() => setReach(false)} />;
      })()}
    </>
  );
}
