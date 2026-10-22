import { useEffect, useRef, useState } from "react";
import { api, stream } from "../api";
import { fa, short, toman } from "../fmt";
import { Icon } from "../icons";
import type { Ctx, InquiryShop, InquirySummary, ProductCard as PC, Reply, ShopOffer } from "../types";
import { AiNote, AuthBadge } from "./bits";
import { Img, availability } from "./Products";
import { SellerRow } from "./ShopsView";

const OUTCOME: Record<Reply["outcome"], { label: string; tone: string }> = {
  confirmed: { label: "موجود، تأیید شد", tone: "green" },
  price_changed: { label: "قیمت تغییر کرده", tone: "amber" },
  out_of_stock: { label: "ناموجود", tone: "red" },
  no_answer: { label: "بی‌پاسخ", tone: "gray" },
  closed: { label: "بسته بود", tone: "gray" },
};
const SCENARIOS: [string, string][] = [["", "خودکار"], ["confirmed", "موجود"], ["price_changed", "تغییر قیمت"], ["out_of_stock", "ناموجود"], ["no_answer", "بی‌پاسخ"]];
const AUTH_TONE: Record<string, string> = { confirmed_copy: "red", unclear: "amber", claimed_original: "green" };

export type InquiryState = {
  pid: number;
  sids: number[];
  started: boolean;
  shops: InquiryShop[];
  replies: Record<number, Reply>;
  summary: InquirySummary | null;
  callScript: string[];
  notice: string;
  product: { pid: number; title: string; image: string | null; price_min: number | null } | null;
};

export function InquiryView({ st, setSt, ctx, demo, onOpenShop, onVisit, onRestart, onProduct, toast }: {
  st: InquiryState;
  setSt: (f: (s: InquiryState) => InquiryState) => void;
  ctx: Ctx;
  demo: boolean;
  onOpenShop: (sid: number, offer?: ShopOffer) => void;
  onVisit: (sids: number[], confirmed: Record<number, unknown>) => void;
  onRestart: (sids: number[]) => void;
  onProduct: (p: PC) => void;
  toast: (s: string) => void;
}) {
  const [forced, setForced] = useState<Record<number, string>>({});
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<{ shops: InquiryShop[]; callScript: string[]; notice: string } | null>(null);
  const [showScript, setShowScript] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const ran = useRef<string>("");
  const key = `${st.pid}:${st.sids.join(",")}`;

  // Drafts are shown (and can be reviewed) before anything is sent.
  useEffect(() => {
    if (st.started || ran.current === key) return;
    ran.current = key;
    setPreview(null);
    api.draft(st.pid, st.sids, ctx).then((ev) => {
      setPreview({ shops: ev.shops, callScript: ev.call_script, notice: ev.notice });
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
  const confirmedMap: Record<number, unknown> = {};
  for (const r of Object.values(st.replies)) if (r.in_stock) confirmedMap[r.sid] = { confirmed_price: r.confirmed_price, hold_until: r.hold_until, hold_until_at: r.hold_until_at, hold_code: r.hold_code };
  const nConfirmed = Object.keys(confirmedMap).length;
  const nReplies = Object.keys(st.replies).length;

  return (
    <>
      {!st.started ? (
        <div className="card iqhead">
          <img className="iq-art" src="/img/inquiry.webp" width={960} height={400} alt="" />
          <h2>از {fa(st.sids.length)} فروشگاه بپرسم؟</h2>
          <p className="meta ellipsis">{st.product?.title ?? " "}</p>
        </div>
      ) : (
        <div className="pagehead">
          <h2>{running && nReplies < shops.length ? `در حال پرسیدن از ${fa(shops.length)} فروشگاه` : `پاسخ ${fa(shops.length)} فروشگاه`}</h2>
          <p className="meta ellipsis">{st.product?.title}</p>
        </div>
      )}

      {!st.started && (
        <div className="card pad stack" style={{ gap: 8 }}>
          <div className="row between">
            <span className="bold">پیامی که فرستاده می‌شود</span>
            <button className="textbtn" onClick={() => setShowScript(!showScript)}><Icon name="phone" size={15} /> متن تماس تلفنی</button>
          </div>
          {!preview && <div className="shimmer" style={{ height: 72 }} />}
          {preview?.shops[0] && (
            <button className={"bubble-out" + (showDraft ? "" : " clamp3")} onClick={() => setShowDraft(!showDraft)} aria-expanded={showDraft}>
              {preview.shops[0].draft}
            </button>
          )}
          {showScript && preview && (
            <ol className="script">{preview.callScript.map((l, i) => <li key={i}>{l}</li>)}</ol>
          )}
        </div>
      )}

      <div className="card sellers iqlist">
        {!shops.length && <div className="list-skel">{[0, 1, 2].map((i) => <div key={i} className="shimmer" style={{ height: 52 }} />)}</div>}
        {shops.map((s) => {
          const r = st.replies[s.sid];
          const waiting = st.started && !r;
          const o = r ? OUTCOME[r.outcome] : null;
          return (
            <div key={s.sid} className="iqrow fadein">
              <div className="row" style={{ alignItems: "flex-start" }}>
                <button className="grow iq-main" onClick={() => onOpenShop(s.sid)}>
                  <span className="name ellipsis">{s.name}</span>
                  {!r && <span className="meta">ثبت‌شده: {s.price ? toman(s.price) : "بدون قیمت"} · {s.distance_label}</span>}
                </button>
                {!st.started && <AuthBadge a={s.authenticity} />}
                {waiting && <span className="typing sm"><i /><i /><i /></span>}
                {o && <span className={"tag " + o.tone}>{o.label}</span>}
              </div>
              {demo && !st.started && (
                <div className="scenario" aria-label="سناریوی دمو">
                  {SCENARIOS.map(([k, l]) => (
                    <button key={k} className={(forced[s.sid] ?? "") === k ? "on" : ""} onClick={() => setForced((f) => ({ ...f, [s.sid]: k }))}>{l}</button>
                  ))}
                </div>
              )}
              {r && (r.text ? (
                <div className="bubble-in">
                  <span>{r.text}</span>
                  <small className="simlabel">پاسخ شبیه‌سازی‌شده</small>
                </div>
              ) : (
                <div className="meta">{r.note}</div>
              ))}
              {r?.in_stock && (
                <div className="confirmed-line">
                  <span className="meta">ثبت‌شده {s.price ? toman(s.price) : "نامعلوم"}</span>
                  <Icon name="left" size={13} className="faint" />
                  <b className="green-txt">تأییدشده {toman(r.confirmed_price)}</b>
                  {!!r.price_delta && <span className={r.price_delta > 0 ? "red-txt" : "green-txt"}>({r.price_delta > 0 ? "+" : "−"}{short(Math.abs(r.price_delta))})</span>}
                </div>
              )}
              {r?.hold_until && <div className="meta blue-txt">تا {r.hold_until} برایتان نگه می‌دارند</div>}
              {r?.outcome === "out_of_stock" && r.restock && <div className="meta">فروشنده گفت {r.restock} می‌تواند تهیه کند.</div>}
              {r?.authenticity_check && (
                <div className={"authline " + (AUTH_TONE[r.authenticity_check.status] ?? "")}>
                  <Icon name="shield" size={15} />
                  <span>{r.authenticity_check.label}{r.authenticity_check.confidence && r.authenticity_check.status === "unclear" ? ` (اطمینان ${fa(r.authenticity_check.confidence)}٪)` : ""}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!st.started && <p className="footnote"><Icon name="info" size={13} /> پاسخ فروشگاه‌ها در این نسخه شبیه‌سازی می‌شود، چون شماره‌های داده ساختگی‌اند.</p>}

      {st.started && !sum && nReplies === shops.length && shops.length > 0 && (
        <div className="typing"><i /><i /><i /> <span>در حال جمع‌بندی</span></div>
      )}

      {sum && (
        <>
          <AiNote title="جمع‌بندی دستیار">{sum.text}</AiNote>
          {sum.alternatives.length > 0 && (
            <>
              <div className="listhead"><h3>جایگزین‌های آماده</h3><span className="meta">برای فروشگاه‌هایی که جواب ندادند یا نداشتند</span></div>
              <div className="card sellers">
                {sum.alternatives.map((a) => (
                  <SellerRow key={a.sid} i={a} cheapest={false} selected={false} onToggle={() => onRestart([a.sid])} onOpen={() => onOpenShop(a.sid, a)} />
                ))}
              </div>
              <button className="btn ghost block" onClick={() => onRestart(sum.alternatives.map((a) => a.sid))}>
                <Icon name="chat" size={17} /> استعلام از {fa(sum.alternatives.length)} جایگزین
              </button>
            </>
          )}
          {sum.similar.length > 0 && (
            <>
              <div className="listhead"><h3>کالای مشابه در نزدیکی</h3></div>
              <div className="card sellers">
                {sum.similar.map((p) => (
                  <button key={p.pid} className="simrow" onClick={() => onProduct(p)}>
                    <Img src={p.image} className="pimg sm" />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="small bold clamp2">{p.title}</div>
                      <div className="meta">{availability(p, ctx.radius_km)}</div>
                    </div>
                    <Icon name="left" size={16} className="faint" />
                  </button>
                ))}
              </div>
            </>
          )}
          {sum.leads.length > 0 && (
            <>
              <div className="listhead"><h3>شاید این‌ها هم داشته باشند</h3><span className="meta">تأیید نشده؛ این کالا را ثبت نکرده‌اند</span></div>
              <div className="card sellers">
                {sum.leads.map((l) => (
                  <button key={l.sid} className="simrow" onClick={() => onOpenShop(l.sid)}>
                    <span className="grow bold ellipsis">{l.name}</span><span className="tag amber">تأیید نشده</span><span className="meta">{l.distance_label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {!st.started ? (
        <div className="sticky-cta">
          <button className="btn grow" onClick={start} disabled={!preview || running}>
            <Icon name="send" size={18} className="flip" /> ارسال و استعلام هم‌زمان
          </button>
        </div>
      ) : !running && (
        <div className="sticky-cta">
          <button className="btn grow" disabled={!nConfirmed}
            onClick={() => onVisit(sum?.confirmed_sids?.length ? sum.confirmed_sids : Object.keys(confirmedMap).map(Number), confirmedMap)}>
            <Icon name="route" size={18} /> {nConfirmed ? `برنامهٔ رفتن با ${fa(nConfirmed)} فروشگاه تأییدشده` : "فروشگاه تأییدشده‌ای نماند"}
          </button>
          <button className="btn ghost icon" onClick={() => onRestart(st.sids)} aria-label="استعلام دوباره"><Icon name="refresh" size={19} /></button>
        </div>
      )}
    </>
  );
}
