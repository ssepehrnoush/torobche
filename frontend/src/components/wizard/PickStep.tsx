import { useState } from "react";
import { fa, short } from "../../fmt";
import { Icon } from "../../icons";
import type { FeedItem, Question } from "../../types";
import { Img } from "../Products";
import { Choice, StepHead, WizFoot } from "./Shell";

type AgentItem = Extract<FeedItem, { kind: "agent" }>;

/** Step 4: whatever the assistant answered becomes one screen: a question, a short list of products, or a plain reply. */
export function PickStep({ turn, busy, onBack, onSend, onPick, onRetry }: {
  turn: AgentItem | null;
  busy: boolean;
  onBack: () => void;
  onSend: (text: string) => void;
  onPick: (pid: number) => void;
  onRetry: () => void;
}) {
  if (!turn || (turn.pending && !turn.ask && !turn.products)) return <Thinking status={turn?.status} onBack={onBack} />;
  if (turn.error && !turn.products) {
    return (
      <>
        <StepHead title="یه مشکلی پیش اومد" sub={turn.error} />
        <WizFoot onBack={onBack} next={{ label: <><Icon name="refresh" size={18} /> دوباره امتحان کن</>, onClick: onRetry }} />
      </>
    );
  }
  if (turn.ask?.length) return <Questions key={turn.id} qs={turn.ask} intro={turn.message} busy={busy} onBack={onBack} onSubmit={onSend} />;
  if (turn.products?.length) return <Products key={turn.id} turn={turn} busy={busy} onBack={onBack} onPick={onPick} onRefine={onSend} />;
  return <Reply key={turn.id} message={turn.message ?? ""} chips={turn.suggestions ?? []} busy={busy} onBack={onBack} onSend={onSend} />;
}

function Thinking({ status, onBack }: { status?: string; onBack: () => void }) {
  return (
    <>
      <div className="wz-wait fadein">
        <span className="wz-spin" />
        <b>دارم می‌گردم…</b>
        <span className="meta">{status || "کالاهای مناسب و فروشگاه‌های نزدیک رو پیدا می‌کنم"}</span>
      </div>
      <WizFoot onBack={onBack} next={{ label: "صبر کن…", disabled: true }} />
    </>
  );
}

/** The assistant's clarifying questions, one per screen. */
function Questions({ qs, intro, busy, onBack, onSubmit }: { qs: Question[]; intro?: string; busy: boolean; onBack: () => void; onSubmit: (t: string) => void }) {
  const [qi, setQi] = useState(0);
  const [sel, setSel] = useState<Record<number, string[]>>({});
  const q = qs[qi];
  const cur = sel[qi] ?? [];
  const last = qi === qs.length - 1;
  const pick = (o: string) => {
    const on = cur.includes(o);
    setSel({ ...sel, [qi]: q.multi ? (on ? cur.filter((x) => x !== o) : [...cur, o]) : [o] });
  };
  const next = () => {
    if (!last) return setQi(qi + 1);
    const parts = qs.map((x, i) => ((sel[i] ?? []).length ? `${x.question.replace(/[؟?]$/, "")}: ${sel[i].join("، ")}` : null)).filter(Boolean);
    onSubmit(parts.join("\n"));
  };
  return (
    <>
      <StepHead title={q.question} sub={qs.length > 1 ? `سؤال ${fa(qi + 1)} از ${fa(qs.length)}${q.multi ? " · چند تا رو می‌تونی بزنی" : ""}` : intro} />
      <div className="wz-opts" role={q.multi ? "group" : "radiogroup"}>
        {q.options.map((o) => <Choice key={o} on={cur.includes(o)} multi={q.multi} onClick={() => pick(o)} title={o} />)}
      </div>
      <button className="textbtn muted center" disabled={busy} onClick={() => onSubmit("فرقی نمی‌کند، خودت بهترین‌ها را پیشنهاد بده")}>
        فرقی نمی‌کنه، خودت پیشنهاد بده
      </button>
      <WizFoot onBack={qi > 0 ? () => setQi(qi - 1) : onBack} next={{ label: <>ادامه <Icon name="left" size={18} /></>, onClick: next, disabled: !cur.length || busy }} />
    </>
  );
}

function Products({ turn, busy, onBack, onPick, onRefine }: { turn: AgentItem; busy: boolean; onBack: () => void; onPick: (pid: number) => void; onRefine: (t: string) => void }) {
  const items = turn.products ?? [];
  const [sel, setSel] = useState<number | null>(items.length === 1 ? items[0].pid : null);
  const [refine, setRefine] = useState(false);
  return (
    <>
      <StepHead title="کدوم رو می‌خوای؟" sub={<span className="clamp2">{turn.message || `${fa(items.length)} گزینه پیدا کردم.`}</span>} />
      {turn.notice && <div className="notice"><Icon name="info" size={16} /> {turn.notice}</div>}
      <div className="wz-opts" role="radiogroup">
        {items.slice(0, 4).map((p) => (
          <button key={p.pid} className={"wz-prod" + (sel === p.pid ? " on" : "")} role="radio" aria-checked={sel === p.pid} onClick={() => setSel(p.pid)}>
            <Img src={p.image} className="pimg sm" />
            <span className="grow wz-opt-txt">
              {p.tag && <span className="ptag">{p.tag}</span>}
              <span className="wz-opt-t clamp2">{p.title}</span>
              <span className="meta">
                <b className="wz-price">{p.price_min ? `از ${short(p.nearby_min_price || p.price_min)} تومان` : "قیمت ثبت نشده"}</b>
                {p.n_nearby ? ` · ${fa(p.n_nearby)} فروشگاه نزدیک` : p.n_shops ? " · دور از شما" : ""}
              </span>
            </span>
            <span className={"radio" + (sel === p.pid ? " on" : "")}>{sel === p.pid && <i />}</span>
          </button>
        ))}
      </div>
      {refine ? (
        <RefineField busy={busy} onSend={onRefine} placeholder="مثلاً: ارزون‌تر، یا فقط سامسونگ" />
      ) : (
        <button className="textbtn center" onClick={() => setRefine(true)}>هیچ‌کدوم نیست؟ دقیق‌تر بگو</button>
      )}
      <WizFoot onBack={onBack} next={{ label: <>دیدن فروشگاه‌ها <Icon name="left" size={18} /></>, onClick: () => sel != null && onPick(sel), disabled: sel == null || busy }} />
    </>
  );
}

/** The assistant needs more (or found nothing): its message, one-tap answers it suggested, and a free reply. */
function Reply({ message, chips, busy, onBack, onSend }: { message: string; chips: string[]; busy: boolean; onBack: () => void; onSend: (t: string) => void }) {
  const [text, setText] = useState("");
  return (
    <>
      <StepHead title="یه کم بیشتر بگو" />
      {message && <div className="wz-say">{message}</div>}
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => <button key={c} className="chip" disabled={busy} onClick={() => onSend(c)}>{c}</button>)}
        </div>
      )}
      <form className="wz-field" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSend(text.trim()); }}>
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="جوابت رو بنویس…" aria-label="جواب به دستیار" />
      </form>
      <WizFoot onBack={onBack} next={{ label: <>ادامه <Icon name="left" size={18} /></>, onClick: () => onSend(text.trim()), disabled: !text.trim() || busy }} />
    </>
  );
}

function RefineField({ busy, onSend, placeholder }: { busy: boolean; onSend: (t: string) => void; placeholder: string }) {
  const [text, setText] = useState("");
  return (
    <form className="wz-field sm fadein" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSend(text.trim()); }}>
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label="توضیح بیشتر" />
      <button className="sendbtn" type="submit" disabled={busy || !text.trim()} aria-label="ارسال"><Icon name="up" size={20} stroke={2} /></button>
    </form>
  );
}
