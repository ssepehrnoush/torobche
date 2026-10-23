import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fa, short, toman } from "../../fmt";
import { Icon } from "../../icons";
import type { GenAnswer, GenScreen } from "../../types";
import { Img } from "../Products";
import { Sheet } from "../Sheet";
import { Choice, GrowText, LogoSpin, StepHead, WizFoot } from "./Shell";

/** Which block the model picked, and why: shown on top of every generated screen. */
export function GenBadge({ s }: { s: { source: string; why: string } }) {
  return (
    <div className={"gen-badge fadein" + (s.source === "rule" ? " rule" : "")}>
      <Icon name="spark" size={15} />
      <span className="grow">{s.source === "model" ? "این صفحه رو هوش مصنوعی ساخت" : "صفحهٔ آماده"}{s.why ? `: ${s.why}` : ""}</span>
    </div>
  );
}

/** A product whose own title says it is a copy, or that costs a fraction of the same model elsewhere. */
function CopyHint({ why }: { why: string }) {
  return <span className="gen-copy"><span className="tag amber">احتمالاً غیراصل</span><span>{why}</span></span>;
}

/** Building the screen failed (network, server): say so and offer to try again, never a spinner that never ends. */
export function GenFailed({ onBack, onRetry }: { onBack: () => void; onRetry: () => void }) {
  return (
    <>
      <div className="wz-wait fadein">
        <b>ساختن صفحهٔ بعد نشد</b>
        <span className="meta">شاید اینترنت قطع شده؛ یه بار دیگه امتحان کن.</span>
      </div>
      <WizFoot onBack={onBack} next={{ label: <><Icon name="refresh" size={18} /> دوباره امتحان کن</>, onClick: onRetry }} />
    </>
  );
}

export function GenWait({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div className="wz-wait fadein">
        <LogoSpin />
        <b>دارم صفحهٔ بعد رو می‌سازم…</b>
        <span className="meta">هوش مصنوعی از روی جواب‌هات تصمیم می‌گیره چی بپرسه</span>
      </div>
      <WizFoot onBack={onBack} next={{ label: "صبر کن…", disabled: true }} />
    </>
  );
}

/** One generated screen: a choice, a budget slider, products or a comparison. Place and travel reuse the
    fixed wizard's own steps (Wizard.tsx renders those). */
export function GenStep({ s, busy, onBack, onAnswer, onIntent, onPick, onRestart }: {
  s: GenScreen;
  busy: boolean;
  onBack: () => void;
  onAnswer: (a: GenAnswer) => void;
  onIntent: (a: GenAnswer) => void; // the likely answer, so the next screen can be built before «ادامه»
  onPick: (pid: number) => void;
  onRestart: () => void;
}) {
  if (s.block === "choice") return <GenChoice s={s} busy={busy} onBack={onBack} onAnswer={onAnswer} onIntent={onIntent} />;
  if (s.block === "budget" && s.budget) return <GenBudget s={s} busy={busy} onBack={onBack} onAnswer={onAnswer} onIntent={onIntent} />;
  if (s.block === "compare" && s.compare) return <GenCompareView s={s} onBack={onBack} onPick={onPick} />;
  return <GenProducts s={s} busy={busy} onBack={onBack} onPick={onPick} onAnswer={onAnswer} onRestart={onRestart} />;
}

function GenChoice({ s, busy, onBack, onAnswer, onIntent }: {
  s: GenScreen; busy: boolean; onBack: () => void; onAnswer: (a: GenAnswer) => void; onIntent: (a: GenAnswer) => void;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const pick = (o: string) => {
    const next = s.multi ? (sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o]) : [o];
    setSel(next);
    if (!s.multi) onIntent({ q: s.title, a: o });
  };
  return (
    <>
      <GenBadge s={s} />
      <StepHead title={s.title} sub={s.multi ? "چند تا رو می‌تونی بزنی" : undefined} />
      <div className="wz-opts" role={s.multi ? "group" : "radiogroup"}>
        {(s.options ?? []).map((o) => <Choice key={o} on={sel.includes(o)} multi={s.multi} onClick={() => pick(o)} title={o} />)}
      </div>
      <button className="textbtn muted center" disabled={busy} onClick={() => onAnswer({ q: s.title, a: "فرقی نمی‌کنه، خودت بهترین‌ها رو پیشنهاد بده" })}>
        فرقی نمی‌کنه، خودت پیشنهاد بده
      </button>
      <WizFoot onBack={onBack} next={{ label: <>ادامه <Icon name="left" size={18} /></>, onClick: () => onAnswer({ q: s.title, a: sel.join("، ") }), disabled: !sel.length || busy }} />
    </>
  );
}

function GenBudget({ s, busy, onBack, onAnswer, onIntent }: {
  s: GenScreen; busy: boolean; onBack: () => void; onAnswer: (a: GenAnswer) => void; onIntent: (a: GenAnswer) => void;
}) {
  const b = s.budget!;
  const start = Math.min(b.max, Math.max(b.min, Math.round(b.median / b.step) * b.step));
  const [v, setV] = useState(start);
  useEffect(() => { // build the next screen for the value the slider rests on
    const t = window.setTimeout(() => onIntent({ q: s.title, a: `تا ${toman(v)}`, budget: v }), 600);
    return () => window.clearTimeout(t);
  }, [v]); // eslint-disable-line
  return (
    <>
      <GenBadge s={s} />
      <StepHead title={s.title} sub="بازه از قیمت‌های واقعی همین کالا توی ترب ساخته شده." />
      <div className="gen-budget fadein">
        <b className="gen-budget-v">تا {toman(v)}</b>
        <input type="range" min={b.min} max={b.max} step={b.step} value={v} onChange={(e) => setV(Number(e.target.value))}
          aria-label="سقف بودجه" dir="rtl" />
        <div className="gen-budget-ends"><span>{short(b.min)}</span><span className="meta">میانهٔ قیمت‌ها {short(b.median)}</span><span>{short(b.max)}</span></div>
      </div>
      <button className="textbtn muted center" disabled={busy} onClick={() => onAnswer({ q: s.title, a: "بودجه مهم نیست", budget: 0 })}>بودجه مهم نیست</button>
      <WizFoot onBack={onBack} next={{ label: <>ادامه <Icon name="left" size={18} /></>, onClick: () => onAnswer({ q: s.title, a: `تا ${toman(v)}`, budget: v }), disabled: busy }} />
    </>
  );
}

function GenProducts({ s, busy, onBack, onPick, onAnswer, onRestart }: {
  s: GenScreen; busy: boolean; onBack: () => void; onPick: (pid: number) => void; onAnswer: (a: GenAnswer) => void;
  onRestart: () => void;
}) {
  const items = s.products ?? [];
  const [sel, setSel] = useState<number | null>(items.length === 1 ? items[0].pid : null);
  const [ask, setAsk] = useState(!items.length); // nothing found: the chat to say it another way is open already
  return (
    <>
      <GenBadge s={s} />
      <StepHead title={s.title} />
      <div className="wz-opts" role="radiogroup">
        {items.map((p) => (
          <button key={p.pid} className={"wz-prod" + (sel === p.pid ? " on" : "")} role="radio" aria-checked={sel === p.pid} onClick={() => setSel(p.pid)}>
            <Img src={p.image} className="pimg sm" />
            <span className="grow wz-opt-txt">
              <span className="wz-opt-t clamp2">{p.title}</span>
              <span className="meta">
                <b className="wz-price">{p.price_min ? `از ${short(p.nearby_min_price || p.price_min)} تومان` : "قیمت ثبت نشده"}</b>
                {p.n_nearby ? ` · ${fa(p.n_nearby)} فروشگاه نزدیک` : ""}
              </span>
              {p.copy_hint && <CopyHint why={p.copy_hint} />}
            </span>
            <span className={"radio" + (sel === p.pid ? " on" : "")}>{sel === p.pid && <i />}</span>
          </button>
        ))}
      </div>
      {items.length > 0 && !items.some((p) => p.n_nearby) && (
        <p className="footnote"><Icon name="info" size={13} /> هیچ‌کدوم از این‌ها این دور و بر فروشگاه نداره؛ توی صفحهٔ بعد وسیله یا محدوده رو عوض کن.</p>
      )}
      <button className="textbtn center" onClick={() => setAsk(true)}>
        <Icon name="chat" size={16} /> {items.length ? "هیچ‌کدوم نیست؟ دقیق‌تر بگو" : "یه جور دیگه بنویس"}
      </button>
      {ask && <RefineChat busy={busy} empty={!items.length} onClose={() => setAsk(false)} onSend={(a) => onAnswer({ q: "توضیح بیشتر", a })} />}
      <WizFoot onBack={onBack} next={items.length
        ? { label: <>دیدن فروشگاه‌ها <Icon name="left" size={18} /></>, onClick: () => sel != null && onPick(sel), disabled: sel == null || busy }
        : { label: <><Icon name="refresh" size={18} /> از اول بنویس</>, onClick: onRestart, disabled: busy }} />
    </>
  );
}

const REFINE_IDEAS = ["ارزون‌تر", "باکیفیت‌تر", "یه برند دیگه", "فقط اورجینال"];

/** «دقیق‌تر بگو» as a short chat: the assistant asks what to change, the person answers in their own words (or taps
    an idea), and the next screen is built from that. */
function RefineChat({ busy, empty, onClose, onSend }: { busy: boolean; empty: boolean; onClose: () => void; onSend: (a: string) => void }) {
  const [text, setText] = useState("");
  const send = (t: string) => { if (t.trim() && !busy) onSend(t.trim()); };
  // rendered on the body: the screen it opens from is animated with a transform, and a fixed sheet inside a
  // transformed box is placed relative to that box, off the screen, so a tap seemed to do nothing
  return createPortal(
    <Sheet title="دقیق‌تر بگو" onClose={onClose} footer={
      <div className="wz-field wz-chatbox">
        <GrowText value={text} onChange={setText} onEnter={() => send(text)} label="توضیح بیشتر" autoFocus
          placeholder="مثلاً: ارزون‌تر، یا فقط سامسونگ، یا برای ورزش" />
        <button className="sendbtn" onClick={() => send(text)} disabled={busy || !text.trim()} aria-label="بفرست"><Icon name="up" size={20} stroke={2} /></button>
      </div>
    }>
      <div className="wz-chat">
        <div className="wz-chat-ai">
          <Icon name="spark" size={16} />
          <span>{empty
            ? "با این توضیح توی ترب چیزی پیدا نکردم. یه جور دیگه بگو چی می‌خوای، خودم دوباره می‌گردم."
            : "بگو چی رو عوض کنم: بودجه، برند، کاربری یا هر چیزی که مهمه. با همین، کالاهای تازه پیدا می‌کنم."}</span>
        </div>
        {!empty && (
          <div className="chips">
            {REFINE_IDEAS.map((t) => <button key={t} className="chip sm" disabled={busy} onClick={() => send(t)}>{t}</button>)}
          </div>
        )}
      </div>
    </Sheet>,
    document.body,
  );
}

function GenCompareView({ s, onBack, onPick }: { s: GenScreen; onBack: () => void; onPick: (pid: number) => void }) {
  const c = s.compare!;
  const cols = `minmax(84px, 0.8fr) repeat(${c.products.length}, 1fr)`;
  return (
    <>
      <GenBadge s={s} />
      <StepHead title={s.title} sub="فقط فرق‌هاشون رو آوردم." />
      <div className="gen-compare fadein">
        <div className="gen-crow head" style={{ gridTemplateColumns: cols }}>
          <span />
          {c.products.map((p) => (
            <span key={p.pid} className="gen-cprod">
              <Img src={p.image} className="pimg sm" />
              <span className="clamp2">{p.title}</span>
              {p.copy_hint && <span className="tag amber" title={p.copy_hint}>احتمالاً غیراصل</span>}
            </span>
          ))}
        </div>
        <div className="gen-crow" style={{ gridTemplateColumns: cols }}>
          <span className="meta">قیمت از</span>
          {c.products.map((p) => <b key={p.pid}>{p.price_min ? short(p.nearby_min_price || p.price_min) : "؟"}</b>)}
        </div>
        <div className="gen-crow" style={{ gridTemplateColumns: cols }}>
          <span className="meta">فروشگاه نزدیک</span>
          {c.products.map((p) => <span key={p.pid}>{fa(p.n_nearby ?? 0)}</span>)}
        </div>
        {c.rows.map((r) => (
          <div key={r.key} className="gen-crow" style={{ gridTemplateColumns: cols }}>
            <span className="meta">{r.key}</span>
            {r.values.map((v, i) => <span key={i}>{v ?? "-"}</span>)}
          </div>
        ))}
        <div className="gen-crow pick" style={{ gridTemplateColumns: cols }}>
          <span />
          {c.products.map((p) => <button key={p.pid} className="btn sm" onClick={() => onPick(p.pid)}>همین</button>)}
        </div>
      </div>
      <WizFoot onBack={onBack} next={{ label: "یکی رو از جدول انتخاب کن", disabled: true }} />
    </>
  );
}
