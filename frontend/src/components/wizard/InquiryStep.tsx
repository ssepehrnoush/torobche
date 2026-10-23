import { useEffect, useRef, useState } from "react";
import { api, stream } from "../../api";
import { fa, toman } from "../../fmt";
import { Icon } from "../../icons";
import { askToNotify, notify } from "../../notify";
import type { Ctx, InquiryShop, InquirySummary, Reply } from "../../types";
import { AiNote } from "../bits";
import type { InquiryState } from "../InquiryView";
import { StepHead, WizFoot } from "./Shell";
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

/** What the automated call asks one shop: the shared script, with this shop's own registered price. */
function callLines(script: string[] | undefined, title: string | undefined, price: number | null | undefined): string[] {
  const base = script?.length ? script : ["سلام، وقت بخیر. از طریق ترب با فروشگاه شما آشنا شدم."];
  const out = [base[0], title ? `«${title}» را موجود دارید؟` : base[1]];
  out.push(price ? `قیمت ثبت‌شده ${toman(price)} است؛ قیمت امروز چقدر است؟` : "قیمت امروزش چقدر است؟");
  if (base[3]) out.push(base[3]);
  return out.filter(Boolean);
}

/* A tester can play the first shop on their own phone; the number is remembered on this device only. */
const TESTER_KEY = "torobche.testerPhone";
const digits = (s: string) => s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/\D/g, "");
const isMobile = (s: string) => /^(0098|98|0)?9\d{9}$/.test(digits(s));

const STEP_NAME: Record<string, string> = { whatsapp: "واتساپ", sms: "پیامک", call: "تماس هوش مصنوعی", bale: "بله" };
type StepState = "wait" | "sent" | "calling" | "off" | "won";

/** A shop's ways of being asked, in the order the shop itself chose, as one row of steps: the one being tried
    lights up (a message leaving, or a phone ringing), an unanswered one dims and the line to the next fills,
    and the one the answer came on turns green. Before sending it is the same row, numbered. */
function ChanLadder({ ways, log, reply, started }: {
  ways: { k: string; label: string }[]; log: Chan[]; reply?: Reply; started: boolean;
}) {
  const last: Record<string, Chan> = {};
  for (const c of log) last[c.channel] = c;
  const state = (k: string): StepState => {
    if (reply?.via === k) return "won";
    const c = last[k];
    if (!c) return "wait";
    if (c.state === "no_answer" || reply) return "off";
    return c.state === "calling" ? "calling" : "sent";
  };
  const note: Record<StepState, string> = { wait: "", sent: "رفت، منتظر جواب", calling: "داره زنگ می‌زنه", off: "جواب نداد", won: "جواب داد" };
  return (
    <ol className={"ladder" + (started ? " live" : "")} aria-label="راه‌های پرسیدن از این فروشگاه، به ترتیب خودش">
      {ways.map((w, i) => {
        const st = started ? state(w.k) : "wait";
        const real = last[w.k]?.real;
        return (
          <li key={w.k} className={`lad ${w.k} ${st}`}>
            {i > 0 && <span className={"lad-line" + (st !== "wait" ? " on" : "")} aria-hidden="true"><i /></span>}
            <span className="lad-ico">
              <Icon name={st === "won" ? "check" : CHAN_ICON[w.k] ?? "chat"} size={16} stroke={st === "won" ? 2.6 : 1.8} />
              {!started && <b className="lad-n">{fa(i + 1)}</b>}
              {st === "calling" && <><em className="ring r1" /><em className="ring r2" /></>}
              {st === "sent" && <em className="fly" />}
            </span>
            <span className="lad-t">{STEP_NAME[w.k] ?? w.label}{real ? " (واقعی)" : ""}</span>
            {started && note[st] && <span className="lad-s">{note[st]}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** While the assistant is on the phone with a shop: who it is calling, a live voice wave and timer, and what it
    asks, line by line, the way the automated call says it. */
function CallCard({ shop, lines, done }: { shop: string; lines: string[]; done: boolean }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (done) return;
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [done]);
  const shown = done ? lines.length : Math.min(lines.length, 1 + Math.floor(t / 1.6));
  return (
    <div className={"wz-call fadein" + (done ? " done" : "")} role="status">
      <div className="wz-call-head">
        <span className="wz-call-ava"><Icon name="spark" size={18} />{!done && <><em className="ring r1" /><em className="ring r2" /></>}</span>
        <span className="grow stack" style={{ gap: 0 }}>
          <b>{done ? "تماس تمام شد" : "هوش مصنوعی داره زنگ می‌زنه"}</b>
          <span className="meta">به «{shop}» · {fa(Math.floor(t / 60))}:{fa(String(t % 60).padStart(2, "0"))}</span>
        </span>
        {!done && <span className="wz-wave" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i} />)}</span>}
      </div>
      <ul className="wz-call-lines">
        {lines.slice(0, shown).map((l, i) => <li key={i} className="fadein">{l}</li>)}
      </ul>
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
                  <div className="wz-iq-ch">
                    <span className="meta">به ترتیبی که خود فروشگاه خواسته:</span>
                    <ChanLadder ways={s.channels} log={[]} started={false} />
                  </div>
                ) : null
              ) : (
                <div className="wz-thread">
                  {s.channels?.length ? <ChanLadder ways={s.channels} log={log[s.sid] ?? []} reply={r} started /> : null}
                  {(() => {
                    const c = (log[s.sid] ?? []).find((x) => x.channel === "call" && x.state === "calling");
                    const off = (log[s.sid] ?? []).some((x) => x.channel === "call" && x.state === "no_answer");
                    const won = r?.via === "call";
                    if (!won && !(c && !off && !r)) return null; // only while ringing, or when the call got the answer
                    return <CallCard shop={s.name} done={won} lines={callLines(st.callScript, st.product?.title, s.price)} />;
                  })()}
                  {!r && !(log[s.sid] ?? []).some((x) => x.state === "calling") && <span className="typing sm"><i /><i /><i /></span>}
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
    </>
  );
}
