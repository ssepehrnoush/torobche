import { useEffect, useState } from "react";
import { api } from "./api";
import { RadishLogo } from "./components/Logo";
import { fa, num, parseToman, toman } from "./fmt";
import { Icon } from "./icons";
import type { ShopAnswer, ShopReplyPage } from "./types";

const DONE: Record<ShopAnswer["outcome"], string> = {
  confirmed: "موجوده، با همین قیمت",
  price_changed: "موجوده، قیمت امروز",
  out_of_stock: "نداریم",
  no_answer: "بی‌جواب ماند",
};

/* A shopkeeper types a full price with any separators («۲٫۹۵۰٫۰۰۰», «2,950,000»), where parseToman would
   read «٫» as a decimal point; words («۳ میلیون») still go through parseToman. */
function readPrice(s: string): number | null {
  if (/میلیون|میلیارد|هزار/.test(s)) return parseToman(s);
  const d = s.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/\D/g, "");
  const n = d ? parseInt(d, 10) : 0;
  return n >= 1000 ? n : null;
}

/** The shop's side (/r/<token>): opened from the inquiry text message, one tap answers the customer. */
export default function ShopReply({ token }: { token: string }) {
  const [page, setPage] = useState<ShopReplyPage | null>(null);
  const [gone, setGone] = useState(false);
  const [askPrice, setAskPrice] = useState(false);
  const [priceText, setPriceText] = useState("");
  const [busy, setBusy] = useState(false);
  const [late, setLate] = useState(false);
  const [keep, setKeep] = useState(2); // hours the item is held for the customer; 0 = not held

  useEffect(() => {
    api.replyPage(token).then(setPage).catch(() => setGone(true));
  }, [token]);

  const send = async (outcome: string, price: number | null = null) => {
    if (!page || busy) return;
    setBusy(true);
    try {
      const r = await api.reply(token, outcome, price, outcome === "out_of_stock" ? null : keep || null);
      if (r.answer) {
        setLate(!r.ok);
        setPage({ ...page, answer: r.answer });
      }
    } catch {
      setGone(true);
    }
    setBusy(false);
  };
  const newPrice = readPrice(priceText);

  return (
    <div className="shopreply">
      <header className="sr-head">
        <RadishLogo size={28} />
        <b>تربچه</b>
        <i className="sep" />
        <span>استعلام مشتری</span>
      </header>

      {gone && <div className="card empty">این لینک منقضی شده یا دیگر معتبر نیست.</div>}
      {!page && !gone && <div className="shimmer" style={{ height: 220, borderRadius: 16 }} />}

      {page && (
        <>
          <div className="sr-card">
            {page.image ? <img src={page.image} alt="" /> : <span className="sr-noimg"><Icon name="bag" size={26} /></span>}
            <div className="grow stack" style={{ gap: 4, minWidth: 0 }}>
              <b className="clamp2">{page.product}</b>
              <span className="meta">{page.shop}</span>
              {page.price ? <span className="meta">قیمت ثبت‌شدهٔ شما در ترب: <b>{toman(page.price)}</b></span> : null}
            </div>
          </div>

          {!page.answer ? (
            <>
              <h1 className="sr-q">یه مشتری نزدیکتونه و همین رو می‌خواد. الان موجود دارید؟</h1>
              <div className="sr-keep" role="radiogroup" aria-label="نگه داشتن برای مشتری">
                <span className="meta">اگه داری، براش نگه می‌داری؟</span>
                {[[1, "۱ ساعت"], [2, "۲ ساعت"], [0, "نه"]].map(([h, l]) => (
                  <button key={h} className={"chip" + (keep === h ? " on" : "")} role="radio" aria-checked={keep === h} onClick={() => setKeep(h as number)}>{l}</button>
                ))}
              </div>
              <div className="stack" style={{ gap: 10 }}>
                <button className="btn block sr-yes" disabled={busy} onClick={() => send("confirmed")}>
                  <Icon name="check" size={19} stroke={2.4} /> موجوده، با همین قیمت
                </button>
                {!askPrice ? (
                  <button className="btn ghost block" disabled={busy} onClick={() => setAskPrice(true)}>
                    <Icon name="tag" size={18} /> موجوده، قیمتش عوض شده
                  </button>
                ) : (
                  <form className="sr-price" onSubmit={(e) => { e.preventDefault(); if (newPrice) send("price_changed", newPrice); }}>
                    <input autoFocus inputMode="numeric" placeholder="قیمت امروز به تومان" value={priceText}
                      onChange={(e) => setPriceText(e.target.value)} aria-label="قیمت امروز به تومان" />
                    <button className="btn" disabled={!newPrice || busy}>ثبت</button>
                    {newPrice ? <span className="meta">{num(newPrice)} تومان</span> : null}
                  </form>
                )}
                <button className="btn ghost block sr-no" disabled={busy} onClick={() => send("out_of_stock")}>
                  <Icon name="x" size={18} /> نداریم
                </button>
              </div>
            </>
          ) : (
            <div className={"sr-done" + (page.answer.outcome === "out_of_stock" || page.answer.outcome === "no_answer" ? " off" : "")}>
              <Icon name={page.answer.expired ? "hourglass" : "check"} size={28} stroke={2.2} />
              {page.answer.expired ? (
                <b>مهلت این استعلام تمام شده</b>
              ) : (
                <>
                  <b>{late ? "پیش از شما جواب ثبت شده بود" : "ممنون! جوابت برای مشتری رفت"}</b>
                  <span>
                    {DONE[page.answer.outcome]}
                    {page.answer.outcome === "price_changed" && page.answer.price ? ` ${toman(page.answer.price)}` : ""}
                    {page.answer.at ? `، ساعت ${page.answer.at}` : ""}
                  </span>
                  {page.answer.hold_code && (
                    <span className="sr-code">کد رزرو مشتری: <b>{fa(page.answer.hold_code)}</b> · تا {page.answer.hold_until} نگه دارید</span>
                  )}
                  {!page.answer.real && <span className="meta">این جواب در دمو شبیه‌سازی شده بود.</span>}
                </>
              )}
            </div>
          )}

          <p className="footnote"><Icon name="info" size={13} />
            ترب این لینک رو از راهی که خودتون در پنل فروشنده انتخاب کردید (پیامک یا بله) فرستاده. مشتری فقط جواب شما رو می‌بینه، نه شماره‌تون رو.
          </p>
        </>
      )}
    </div>
  );
}
