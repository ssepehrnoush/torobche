import { useEffect, useState } from "react";
import { api } from "../api";
import { fa, jalali, toman } from "../fmt";
import { Icon } from "../icons";
import type { Authenticity, Ctx, MallBuilding as Building, MallGuide, ShopDetail } from "../types";
import { Fold, MetroStrip, OpenText } from "./bits";
import { MallBuilding } from "./MallBuilding";
import { MASCOT_SVG } from "./mascot";
import { useNavPick } from "./NavPick";
import { Sheet } from "./Sheet";
import { freshTone } from "./ShopsView";

const GUIDE_ICON: Record<string, string> = { building: "building", floor: "floor", door: "door", pin: "pin", help: "help" };
const BADGE_TONE: Record<string, string> = { installment: "blue", torobpay: "violet", delivery: "green", verified: "blue" };

export function ShopSheet({ sid, pid, ctx, auth, onClose, onInquiry, onVisit, onOpenShop }: {
  sid: number;
  pid: number | null;
  ctx: Ctx;
  auth?: Authenticity;
  onClose: () => void;
  onInquiry: (sid: number) => void;
  onVisit: (sid: number) => void;
  onOpenShop: (sid: number) => void;
}) {
  const [d, setD] = useState<ShopDetail | null>(null);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ guide: true });
  const nav = useNavPick();
  const flip = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  useEffect(() => {
    setD(null);
    setErr(false);
    setOpen({ guide: true });
    api.shop(sid, pid, ctx).then(setD).catch(() => setErr(true));
  }, [sid, pid]); // eslint-disable-line
  const today = d?.week.find((w) => w.today);
  return (
    <>
    <Sheet title={d?.name ?? "فروشگاه"} onClose={onClose}
      footer={d && pid ? (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn grow" onClick={() => onInquiry(sid)}><Icon name="chat" size={18} /> استعلام از این فروشگاه</button>
          <button className="btn ghost" onClick={() => onVisit(sid)}><Icon name="route" size={18} /> مسیر</button>
        </div>
      ) : undefined}>
      {err && <div className="empty">اطلاعات فروشگاه دریافت نشد</div>}
      {!d && !err && <div className="shimmer" style={{ height: 260, borderRadius: 16 }} />}
      {d && (
        <>
          <div className="card pad stack" style={{ gap: 6 }}>
            <div className="meta">{d.mall || d.area}</div>
            <div className="statusline">
              <span className={"dot " + (d.open_at_visit.state === "open" ? "green" : d.open_at_visit.state === "closed" ? "red" : "gray")} />
              <OpenText s={d.open_at_visit} />
              <span className="meta">{ctx.visit === "now" ? "وقتی می‌رسید" : "در زمان مراجعه"}</span>
            </div>
            {d.open_at_visit.label !== d.open_now.label && <div className="meta">الان: {d.open_now.label}</div>}
            {d.visit_warning && <div className="warnline"><Icon name="alert" size={14} /> {d.visit_warning}</div>}
            <div className="meta">{d.travel.label} · {d.distance_label}</div>
            {d.travel.legs && d.travel.legs.length > 1 && <MetroStrip legs={d.travel.legs} />}
            {d.travel.warning && <div className="warnline"><Icon name="car" size={14} /> {d.travel.warning}</div>}
          </div>

          {d.offer && (
            <div className="card pad stack" style={{ gap: 6 }}>
              <div className="meta">قیمت ثبت‌شدهٔ این کالا در ترب</div>
              <div className="row between wrap" style={{ gap: 8 }}>
                <span className="price lg">{toman(d.offer.price)}</span>
                <span className={"tag " + freshTone(d.offer.freshness)}>{d.offer.freshness.label}</span>
              </div>
              {d.offer.freshness.ts && <div className="meta">آخرین تغییر قیمت: {jalali(d.offer.freshness.ts)}</div>}
              <div className="warnline"><Icon name="info" size={14} /> موجودی تأیید نشده؛ برای اطمینان استعلام بگیرید.</div>
              <div className="hr" />
              <div className="meta">عنوان فروشنده: {d.offer.seller_title}</div>
              {d.offer.warranty && <div className="meta">گارانتی: {d.offer.warranty}</div>}
              {auth && auth.status !== "unknown" && (
                <div className={"authbox " + auth.status}>
                  <b>{auth.label}{auth.confidence ? ` (اطمینان ${fa(auth.confidence)}٪)` : ""}</b>
                  {auth.reasons.map((r) => <span key={r}>{r}</span>)}
                  <small>برآورد از دادهٔ ترب است، نه قطعی؛ در استعلام از فروشنده پرسیده می‌شود.</small>
                </div>
              )}
              <div className="row wrap" style={{ gap: 4 }}>
                {d.badges.map((b) => <span key={b.label} className={"tag " + (BADGE_TONE[b.kind] ?? "gray")}>{b.label}</span>)}
                {!d.installments.length && <span className="tag gray">خرید قسطی ثبت نشده</span>}
              </div>
            </div>
          )}

          <div className="folds">
            {d.mall_guide && (
              <Fold title="مسیر داخل پاساژ" summary={[d.mall_guide.floor, d.mall_guide.unit ? `واحد ${d.mall_guide.unit}` : ""].filter(Boolean).join("، ")} open={!!open.guide} onToggle={() => flip("guide")}>
                <Guide g={d.mall_guide} b={d.mall_building} arrive={d.arrive} onOpenShop={onOpenShop} />
              </Fold>
            )}
            <Fold title="ساعت کاری ثبت‌شده" summary={today ? `امروز ${today.text}` : undefined} open={!!open.hours} onToggle={() => flip("hours")}>
              <table className="table hours">
                <tbody>
                  {d.week.map((w) => (
                    <tr key={w.dow} className={w.today ? "today" : ""}>
                      <th>{w.day}{w.today ? " (امروز)" : ""}</th>
                      <td>{w.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Fold>
            <Fold title="تماس و مسیریابی" open={!!open.contact} onToggle={() => flip("contact")}>
              <div className="navbtns">
                <button className="btn ghost sm" onClick={() => nav.open(d.nav)}><Icon name="nav" size={15} /> مسیریابی</button>
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                {d.phone && <a className="btn ghost sm" href={`tel:${d.phone}`}><Icon name="phone" size={15} /> {fa(d.phone)}</a>}
                {d.instagram_url && <a className="btn ghost sm" href={d.instagram_url} target="_blank" rel="noreferrer">اینستاگرام</a>}
                {d.website_url && <a className="btn ghost sm" href={d.website_url} target="_blank" rel="noreferrer">وب‌سایت</a>}
              </div>
              <div className="meta">{d.phone_note}{d.is_real_name ? "" : "؛ نام این فروشگاه هم در داده ساختگی است."}</div>
            </Fold>
            {d.same_mall_offers.length > 0 && (
              <Fold title="همین کالا در همین پاساژ" summary={`${fa(d.same_mall_offers.length)} فروشگاه`} open={!!open.same} onToggle={() => flip("same")}>
                <div className="meta">اگر این فروشگاه بسته بود یا موجود نداشت، چند قدم آن‌طرف‌تر:</div>
                {d.same_mall_offers.map((o) => (
                  <button key={o.sid} className="samerow" onClick={() => onOpenShop(o.sid)}>
                    <span className="grow" style={{ minWidth: 0 }}><b>{o.name}</b> <span className="meta">{o.mall}</span></span>
                    <span className="bold">{toman(o.price)}</span>
                  </button>
                ))}
              </Fold>
            )}
            {d.categories.length > 0 && (
              <Fold title="دسته‌هایی که اعلام کرده" summary={`${fa(d.n_products)} کالا در ترب`} open={!!open.cats} onToggle={() => flip("cats")}>
                <div className="row wrap" style={{ gap: 4 }}>{d.categories.map((c) => <span key={c} className="tag gray">{c}</span>)}</div>
              </Fold>
            )}
          </div>
        </>
      )}
    </Sheet>
    </>
  );
}

/** Inside the mall: for someone at its door one plain sentence (shown by itself when their spot is already there),
    the floors drawn as a building, then the steps. */
function Guide({ g, b, arrive, onOpenShop }: {
  g: MallGuide; b: Building | null; arrive: ShopDetail["arrive"]; onOpenShop: (sid: number) => void;
}) {
  const [here, setHere] = useState(!!arrive?.near);
  return (
    <div className="stack" style={{ gap: 12 }}>
      {arrive && (here ? (
        <div className="atdoor fadein">
          <span className="atdoor-ic" dangerouslySetInnerHTML={{ __html: MASCOT_SVG }} />
          <span className="stack" style={{ gap: 2 }}><b>{arrive.title}</b><span>{arrive.text}</span></span>
        </div>
      ) : (
        <button className="textbtn atdoor-btn" onClick={() => setHere(true)}><Icon name="pin" size={16} /> الان دم پاساژم، کجا برم؟</button>
      ))}
      {b && <MallBuilding b={b} onOpenShop={onOpenShop} />}
      <div className="guidewrap">
        <ol className="guide grow">
          {g.steps.map((s, i) => (
            <li key={i}>
              <span className="gi"><Icon name={GUIDE_ICON[s.icon] ?? "info"} size={16} /></span>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
        {!b && g.floors.length > 1 && (
          <div className="floors" aria-label="طبقات پاساژ">
            <span className="meta center">{g.mall_name ?? "پاساژ"}</span>
            {[...g.floors].sort((a, b) => b.num - a.num).map((f) => (
              <div key={f.num} className={"floor" + (f.target ? " target" : "")}>
                <span>{f.num === 0 ? "همکف" : f.num < 0 ? `منفی ${fa(-f.num)}` : `طبقه ${fa(f.num)}`}</span>
                <span>{fa(f.shops)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {g.landmarks.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="meta">واحدهای همسایه برای پیدا کردن راحت‌تر:</span>
          <div className="row wrap" style={{ gap: 6 }}>
            {g.landmarks.map((l) => (
              <button key={l.sid} className="chip xs" onClick={() => onOpenShop(l.sid)}>واحد {l.unit}: {l.name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="meta">{g.source}{g.mall_shop_count > 1 ? ` · ${fa(g.mall_shop_count)} فروشگاه ثبت‌شده در این پاساژ` : ""}</div>
    </div>
  );
}
