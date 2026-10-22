import type { ReactNode } from "react";
import { fa, metroColor, toman } from "../fmt";
import { Icon } from "../icons";
import type { Authenticity, Bargain, Freshness, Leg, OpenState, Travel } from "../types";

export const MODE_ICON: Record<string, string> = { walk: "walk", car: "car", transit: "train", metro: "train", taxi: "car", transfer: "refresh" };

/** "باز تا ۲۱:۰۰" in green, "بسته" in red, «ساعت کاری ثبت نشده» in grey: same words everywhere. */
export function OpenText({ s }: { s: OpenState }) {
  if (s.state === "open") return <span className="open-txt">{s.closes_at ? `باز تا ${s.closes_at}` : "باز"}</span>;
  if (s.state === "closed") return <span className="closed-txt">{s.opens_at ? `بسته، باز می‌شود ${s.opens_at}` : "بسته"}</span>;
  return <span className="muted">ساعت کاری ثبت نشده</span>;
}

/** How old the registered price is, short enough for a list row: «قیمت ۳ روز پیش», old ones in amber.
    The registered price is never the confirmed one; that comes only from asking the shop. */
export function PriceAge({ f }: { f?: Freshness }) {
  if (!f || f.days == null) return <span className="muted">زمان ثبت قیمت نامعلوم</span>;
  return <span className={f.tier === "fresh" ? "muted" : "price-old"} title={f.label}>{f.days === 0 ? "قیمت امروز" : `قیمت ${fa(f.days)} روز پیش`}</span>;
}

/** One short travel line for a list row: "۴۶ دقیقه · خط ۱" for metro, "۱۵ دقیقه پیاده", "۱۲ دقیقه با ماشین". */
export function TravelInline({ t }: { t: Travel }) {
  const metro = t.legs?.find((l) => l.mode === "metro");
  const how = t.mode === "walk" ? "پیاده" : t.mode === "car" ? "با ماشین" : "";
  return (
    <span className="travel-inline">
      <Icon name={MODE_ICON[t.mode] ?? "route"} size={15} />
      {fa(t.minutes)} دقیقه{how ? ` ${how}` : ""}
      {metro && <i className="line-dot" style={{ background: metroColor(metro.line) }}>{metro.line?.replace("خط ", "")}</i>}
    </span>
  );
}

/** Schematic public-transport route: walk → metro line X (stations) → transfer → taxi, minutes under each leg. */
export function MetroStrip({ legs }: { legs: Leg[] }) {
  return (
    <div className="metrostrip" role="list" aria-label="مسیر با مترو و اتوبوس">
      {legs.map((l, i) => (
        <div key={i} className={"leg " + l.mode} role="listitem">
          <span className="leg-ico" style={l.mode === "metro" ? { background: metroColor(l.line), color: "#fff" } : undefined}>
            {l.mode === "metro" ? <b>{l.line?.replace("خط ", "")}</b> : <Icon name={MODE_ICON[l.mode] ?? "route"} size={15} />}
          </span>
          <span className="leg-txt">
            <b>{l.mode === "metro" ? l.line : l.label}</b>
            <small>
              {l.mode === "metro" ? `${l.board} تا ${l.alight}، ${fa(l.stops ?? 0)} ایستگاه` : l.mode === "transfer" ? `در ${l.at}` : l.to && l.to !== "فروشگاه" ? `تا ${l.to}` : "تا فروشگاه"}
            </small>
          </span>
          <span className="leg-min">{fa(l.minutes)}′</span>
        </div>
      ))}
    </div>
  );
}

/** Only two authenticity states earn a badge in lists; the rest live in the shop sheet. */
export function AuthBadge({ a }: { a?: Authenticity | null }) {
  if (!a) return null;
  if (a.status === "declared_copy") return <span className="tag red">غیراصل</span>;
  if (a.status === "suspicious") return <span className="tag amber">احتمالاً غیراصل</span>;
  return null;
}

/** The assistant's voice on a screen: violet spark like torob's own AI entry points. */
export function AiNote({ title, children, loading }: { title?: ReactNode; children?: ReactNode; loading?: boolean }) {
  return (
    <div className="ainote fadein">
      <span className="ai-dot"><Icon name="spark" size={15} stroke={1.8} /></span>
      <div className="grow">
        {loading ? (
          <>
            <div className="shimmer" style={{ height: 14, width: "55%" }} />
            <div className="shimmer" style={{ height: 12, marginTop: 8 }} />
          </>
        ) : (
          <>
            {title && <div className="ainote-title">{title}</div>}
            {children && <div className="ainote-body">{children}</div>}
          </>
        )}
      </div>
    </div>
  );
}

/** «یه پیشنهاد خیلی خوب کمی دورتر دارم»: saving against extra travel, one button. */
export function BargainCard({ b, onOpen }: { b: Bargain; onOpen: () => void }) {
  return (
    <div className="bargain fadein">
      <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
        <span className="ai-dot"><Icon name="spark" size={15} stroke={1.8} /></span>
        <p className="grow" style={{ margin: 0 }}>{b.message}</p>
      </div>
      <div className="bargain-shop">
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="bold ellipsis">{b.name}</div>
          <div className="meta ellipsis">{b.mall}</div>
          <div className="meta">{b.travel_label}{b.alt_travel ? ` (${b.alt_travel.label})` : ""}</div>
        </div>
        <div className="bargain-num">
          <b>{b.price ? toman(b.price) : "بدون قیمت"}</b>
          {b.saving ? <span className="save">{toman(b.saving)} ارزان‌تر</span> : null}
          {b.extra_minutes ? <span className="meta">{fa(b.extra_minutes)} دقیقه راه بیشتر</span> : null}
        </div>
      </div>
      <button className="btn blue block" onClick={onOpen}>بله، بررسی کنیم</button>
    </div>
  );
}

/** A labelled section that opens and closes; used for details that would otherwise make a sheet long. */
export function Fold({ title, summary, open, onToggle, children }: { title: string; summary?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className={"fold" + (open ? " open" : "")}>
      <button className="fold-head" onClick={onToggle} aria-expanded={open}>
        <span className="bold">{title}</span>
        {summary && <span className="fold-sum">{summary}</span>}
        <Icon name="down" size={16} className="fold-chev" />
      </button>
      {open && <div className="fold-body">{children}</div>}
    </div>
  );
}
