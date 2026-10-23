import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fa } from "../fmt";
import { Icon } from "../icons";
import type { MallGuide } from "../types";

/* The way to a shop inside its mall as a short story: three illustrated cards (the radish at the door, in the lift
   with its floor counting up, in front of the shop with its unit plate), each with one plain sentence from the
   shop's own address in Torob's data. They advance by themselves; a tap goes on (the left half) or back. */

const SECS = 3.8;

export function MallStory({ g, shop, onClose }: { g: MallGuide; shop: string; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [t, setT] = useState(0);
  const t0 = useRef(performance.now());
  const f = g.floor_num;
  const mall = (g.mall_name ?? "پاساژ").replace("علاالدین", "علاءالدین");
  const lm = g.landmarks.find((l) => l.unit !== g.unit) ?? null;
  const cards = [
    { img: "story_entrance", kicker: "۱. در ورودی", title: `رسیدی به ${mall}`, sub: g.street ? `ورودی ${g.street}` : "از در اصلی برو داخل" },
    {
      img: "story_elevator", kicker: "۲. طبقه",
      title: f == null ? "طبقه‌اش ثبت نشده؛ از اطلاعات پاساژ بپرس" : f === 0 ? "همین طبقهٔ همکف بمون" : f > 0 ? `با آسانسور برو طبقهٔ ${fa(f)}` : `برو طبقهٔ منفی ${fa(-f)}`,
      sub: f != null && Math.abs(f) >= 3 ? "آسانسور یا پله‌برقی" : "پله‌برقی یا پله",
    },
    { img: "story_shop", kicker: "۳. واحد", title: g.unit ? `واحد ${g.unit}` : shop, sub: lm ? `«${shop}»، نزدیک «${lm.name}» (واحد ${lm.unit})` : `«${shop}»` },
  ];

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = (performance.now() - t0.current) / 1000;
      setT(s);
      if (s >= SECS) {
        setI((x) => {
          if (x < cards.length - 1) { t0.current = performance.now(); return x + 1; }
          return x;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", k); };
  }, []); // eslint-disable-line
  const go = (d: number) => { setI((x) => Math.max(0, Math.min(cards.length - 1, x + d))); t0.current = performance.now(); };
  const c = cards[i];
  // the lift's display counts from the ground floor to the shop's
  const shown = f == null ? null : Math.round(Math.min(1, t / 1.6) * f);

  return createPortal(
    <div className="mstory" data-card={i} role="dialog" aria-label={`راه رسیدن به ${shop} در ${mall}`}>
      <img key={c.img} className="mstory-img" src={`/reach/${c.img}.webp`} alt="" />
      <div className="mstory-top">
        <div className="mstory-bars">
          {cards.map((_, k) => <span key={k}><i style={{ width: `${k < i ? 100 : k > i ? 0 : Math.min(100, (t / SECS) * 100)}%` }} /></span>)}
        </div>
        <button className="iconbtn mstory-x" onClick={onClose} aria-label="بستن"><Icon name="x" size={20} /></button>
      </div>
      <div key={i} className="mstory-cap">
        <span className="mstory-kick">{c.kicker}</span>
        <b>{c.title}</b>
        {c.sub && <span>{c.sub}</span>}
      </div>
      {i === 1 && shown != null && (
        <div className="mstory-lift" aria-hidden="true">
          <Icon name={f != null && f < 0 ? "down" : "up"} size={18} stroke={2.4} />
          <b>{shown === 0 ? "همکف" : shown < 0 ? `-${fa(-shown)}` : fa(shown)}</b>
        </div>
      )}
      {i === 2 && g.unit && <div className="mstory-plate" aria-hidden="true"><small>واحد</small><b>{g.unit}</b></div>}
      <button className="mstory-tap next" onClick={() => go(1)} aria-label="بعدی" />
      <button className="mstory-tap back" onClick={() => go(-1)} aria-label="قبلی" />
      <p className="mstory-src">از روی نشانی همین فروشگاه در دادهٔ ترب</p>
    </div>,
    document.body,
  );
}
