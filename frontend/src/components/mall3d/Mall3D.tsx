import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api";
import { fa } from "../../fmt";
import { Icon } from "../../icons";
import type { Ctx } from "../../types";
import { MASCOT_SVG } from "../mascot";
import { LogoSpin } from "../wizard/Shell";
import { createMallScene, type Mall3DData, type MallScene } from "./scene";

const floorName = (n: number) => (n === 0 ? "همکف" : n < 0 ? `طبقهٔ منفی ${fa(-n)}` : `طبقهٔ ${fa(n)}`);

/** The mall in 3D, over the whole screen: the radish walks from the street to the shop, then the model can be
    turned round with a finger. Loaded on its own, only when opened. */
export default function Mall3D({ sid, pid, ctx, onClose }: { sid: number; pid: number | null; ctx: Ctx; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<MallScene | null>(null);
  const [data, setData] = useState<Mall3DData | null>(null);
  const [err, setErr] = useState(false);
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    api.mall3d(sid, pid, ctx).then(setData).catch(() => setErr(true));
  }, [sid, pid]); // eslint-disable-line

  useEffect(() => {
    if (!data) return;
    let alive = true;
    let s: MallScene | null = null;
    // the labels are drawn on canvases, so the app's font has to be there first
    document.fonts.load("800 40px IRANYekanX").catch(() => null).finally(() => {
      if (!alive || !host.current) return;
      try {
        s = createMallScene(host.current, data, { onArrive: () => setArrived(true) });
      } catch {
        setErr(true);
        return;
      }
      scene.current = s;
      (window as unknown as { __mall3d?: MallScene }).__mall3d = s; // the demo recorder steps it frame by frame
    });
    return () => {
      alive = false;
      s?.dispose();
      (window as unknown as { __mall3d?: MallScene }).__mall3d = undefined;
    };
  }, [data]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return createPortal(
    <div className="m3d" role="dialog" aria-modal="true" aria-label="پاساژ به‌صورت سه‌بعدی">
      <div className="m3d-top">
        <button className="iconbtn" onClick={onClose} aria-label="بستن"><Icon name="x" size={20} /></button>
        <div className="grow stack" style={{ gap: 0, minWidth: 0 }}>
          <b className="ellipsis">{data ? data.mall_name.replace("علاالدین", "علاءالدین") : "پاساژ"}</b>
          {data && <span className="meta ellipsis">{floorName(data.target_floor)}، واحد {data.unit ?? "؟"} · {data.shop}</span>}
        </div>
        <button className="iconbtn" onClick={() => { setArrived(false); scene.current?.replay(); }} aria-label="دوباره نشان بده"><Icon name="refresh" size={19} /></button>
      </div>
      <div className="m3d-stage" ref={host}>
        {!data && !err && <div className="m3d-load"><LogoSpin /><span className="meta">دارم پاساژ رو می‌سازم…</span></div>}
        {err && <div className="m3d-load"><span className="meta">مدل سه‌بعدی باز نشد؛ همان نمای طبقه‌ای در صفحهٔ فروشگاه هست.</span></div>}
      </div>
      <div className={"m3d-card" + (arrived ? " on" : "")}>
        {data?.arrive && (
          <div className="m3d-arrive">
            <span className="m3d-ava" dangerouslySetInnerHTML={{ __html: MASCOT_SVG }} />
            <span>{arrived ? "رسیدی! " : ""}{data.arrive.text}</span>
          </div>
        )}
        <div className="m3d-key">
          <span><i className="k-pin" /> همین فروشگاه</span>
          {data && data.offers > 0 && <span><i className="k-offer" /> همین کالا در {fa(data.offers)} فروشگاه دیگر</span>}
          <span><i className="k-dot" /> بقیهٔ فروشگاه‌ها</span>
        </div>
        <p className="meta" style={{ margin: 0 }}>مدل نمایشی: شکل ساختمان واقعی نیست؛ طبقه و ترتیب واحد هر فروشگاه از دادهٔ ترب است.</p>
      </div>
    </div>,
    document.body,
  );
}
