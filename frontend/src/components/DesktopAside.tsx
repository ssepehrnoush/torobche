import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { fa } from "../fmt";
import { Icon } from "../icons";
import { RadishLogo } from "./Logo";

const STEPS: [string, string, string][] = [
  ["spark", "انتخاب کالا", "اگر مدل را نمی‌دانید، با چند گزینهٔ آماده می‌پرسد و با دلیل پیشنهاد می‌دهد"],
  ["store", "فروشگاه‌های نزدیک", "تا چند دقیقه پیاده، با ماشین یا با مترو؛ قیمت ثبت‌شده و تازگی‌اش، باز بودن در زمان رسیدن، قسطی و اصالت"],
  ["chat", "استعلام", "پیام را می‌نویسد، هم‌زمان از چند فروشگاه می‌پرسد و برای بی‌پاسخ‌ها جایگزین می‌آورد"],
  ["route", "مراجعه", "ترتیب رفتن، ساعت رسیدن، مسیر داخل پاساژ، مسیریابی و یک دور گردش و خرید"],
];

/** Shown beside the phone-sized app on wide screens: what this is, and a QR to open it on a phone. */
export function DesktopAside() {
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(window.location.origin + "/");
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, []);
  return (
    <aside className="aside" aria-label="دربارهٔ تربچه، خرید حضوری">
      <div className="wordmark">
        <RadishLogo size={34} />
        <b>تربچه</b>
        <i className="sep" />
        <span>خرید حضوری</span>
      </div>
      <p className="small" style={{ margin: 0 }}>
        از «چی بخرم؟» تا «کدوم مغازه، کی، از کدوم در پاساژ». برای گوشی طراحی شده؛ با دوربین گوشی اسکن کنید.
      </p>
      <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="stack" style={{ gap: 10 }}>
        {STEPS.map(([icon, title, text], i) => (
          <div key={title} className="row" style={{ alignItems: "flex-start" }}>
            <span className="gi"><Icon name={icon} size={16} /></span>
            <div>
              <div className="bold small">{fa(i + 1)}. {title}</div>
              <div className="tiny">{text}</div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
