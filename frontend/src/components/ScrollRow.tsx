import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { Icon } from "../icons";

/** A row that scrolls sideways with its scrollbar hidden. A finger swipes it; a mouse drags it, or taps the arrow that
    shows at an end with more behind it, so the whole row is reachable without a touch screen too. */
export function ScrollRow({ className = "", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const dragged = useRef(false); // the click that ends a drag is not a tap on a chip
  const [more, setMore] = useState({ back: false, on: false });
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const x = Math.abs(el.scrollLeft); // a right-to-left row scrolls to negative values
    const back = x > 4, on = x + el.clientWidth < el.scrollWidth - 4;
    setMore((m) => (m.back === back && m.on === on ? m : { back, on }));
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(measure); // its chips may change with every render
  const step = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    el.scrollBy({ left: dir * (rtl ? -1 : 1) * el.clientWidth * 0.7, behavior: "smooth" });
  };
  const end = () => {
    if (drag.current?.moved) {
      dragged.current = true;
      window.setTimeout(() => { dragged.current = false; }, 0);
    }
    drag.current = null;
    ref.current?.classList.remove("dragging");
  };
  return (
    <div className="srow">
      {more.back && (
        <button type="button" className="srow-arr back" onClick={() => step(-1)} aria-label="قبلی" tabIndex={-1}>
          <i><Icon name="right" size={15} stroke={2.2} /></i>
        </button>
      )}
      <div ref={ref} className={className + " srow-x"} onScroll={measure} {...rest}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse" || e.button !== 0 || !ref.current) return;
          drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current, el = ref.current;
          if (!d || !el) return;
          if (e.buttons === 0) return end();
          const dx = e.clientX - d.x;
          if (!d.moved && Math.abs(dx) > 6) {
            d.moved = true;
            el.classList.add("dragging");
            el.setPointerCapture(e.pointerId); // a drag that leaves the row keeps going; a tap is never captured
          }
          if (d.moved) el.scrollLeft = d.left - dx;
        }}
        onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
        onClickCapture={(e) => {
          if (!dragged.current) return;
          e.preventDefault();
          e.stopPropagation();
        }}>
        {children}
      </div>
      {more.on && (
        <button type="button" className="srow-arr on" onClick={() => step(1)} aria-label="بیشتر" tabIndex={-1}>
          <i><Icon name="left" size={15} stroke={2.2} /></i>
        </button>
      )}
    </div>
  );
}
