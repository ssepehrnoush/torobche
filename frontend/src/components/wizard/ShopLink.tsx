import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { Icon } from "../../icons";
import type { InquiryShop } from "../../types";
import { Sheet } from "../Sheet";

/** What the shop received: the short text and its one-tap answer page, with a QR to open it on a second phone. */
export function ShopLinkSheet({ shop, onClose, toast }: { shop: InquiryShop; onClose: () => void; toast: (s: string) => void }) {
  const url = `${window.location.origin}/r/${shop.reply_token}`;
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [url]);
  // the text exactly as the shop gets it: the SMS template's branded link, which forwards to the answer page; the QR
  // and the button below open this server's own page, so they work in a local run too
  const text = (shop.sms ?? "").replace(`/r/${shop.reply_token}`, `torobche.lemonai.ir/r/${shop.reply_token}`);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("لینک کپی شد");
    } catch {
      toast("کپی نشد؛ لینک را نگه دارید و کپی کنید");
    }
  };
  return (
    <Sheet title={`پیامی که ${shop.name} گرفت`} onClose={onClose}>
      <div className="bubble-in shoptext">{text}</div>
      <div className="shopqr" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="footnote center"><Icon name="info" size={13} /> با یه گوشی دیگه اسکن کن و جای مغازه‌دار جواب بده؛ جوابش همین‌جا می‌رسه.</p>
      <div className="row" style={{ gap: 8 }}>
        <a className="btn grow" href={url} target="_blank" rel="noreferrer"><Icon name="store" size={17} /> باز کردن صفحهٔ مغازه‌دار</a>
        <button className="btn ghost icon" onClick={copy} aria-label="کپی لینک"><Icon name="copy" size={18} /></button>
      </div>
    </Sheet>
  );
}
