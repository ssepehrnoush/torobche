import { useLayoutEffect, useRef, type ReactNode } from "react";
import { fa } from "../../fmt";
import { Icon } from "../../icons";
import { RadishLogo } from "../Logo";

/** One question per screen: a big title, at most one line under it. */
export function StepHead({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="wz-head fadein">
      <h1>{title}</h1>
      {sub && <p>{sub}</p>}
    </div>
  );
}

/** «مرحلهٔ ۳ از ۷» with one segment per step, like an installer. */
export function Progress({ idx, n }: { idx: number; n: number }) {
  return (
    <div className="wz-progress" role="progressbar" aria-valuemin={1} aria-valuemax={n} aria-valuenow={idx + 1} aria-label={`مرحلهٔ ${fa(idx + 1)} از ${fa(n)}`}>
      <div className="wz-segs">
        {Array.from({ length: n }, (_, i) => <i key={i} className={i <= idx ? "on" : ""} />)}
      </div>
      <span>مرحلهٔ {fa(idx + 1)} از {fa(n)}</span>
    </div>
  );
}

type Next = { label: ReactNode; onClick?: () => void; href?: string; disabled?: boolean };

/** The wizard's fixed bottom: «قبلی» and one main button; an optional quiet line above them. */
const GROW_MAX = 150; // about five lines; past this the box scrolls instead of growing

/** A text box that grows downwards with what is typed, up to about five lines, then scrolls; while typing at the
    end, the end of the text stays in view. Enter sends (Shift+Enter is a new line). */
export function GrowText({ value, onChange, onEnter, placeholder, label, autoFocus }: {
  value: string;
  onChange: (s: string) => void;
  onEnter: () => void;
  placeholder?: string;
  label: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, GROW_MAX)}px`;
    el.style.overflowY = el.scrollHeight > GROW_MAX ? "auto" : "hidden";
    if (el.selectionEnd === el.value.length) el.scrollTop = el.scrollHeight;
  }, [value]);
  return (
    <textarea ref={ref} rows={1} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} placeholder={placeholder}
      enterKeyHint="send" autoFocus={autoFocus}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onEnter(); } }} />
  );
}

/** The wizard's loader: the radish mark turning, in place of a plain spinner. */
export function LogoSpin() {
  return <span className="wz-logo-spin" role="img" aria-label="در حال آماده شدن"><RadishLogo size={56} /></span>;
}

export function WizFoot({ onBack, next, extra, children }: { onBack?: () => void; next: Next; extra?: ReactNode; children?: ReactNode }) {
  return (
    <div className="wz-foot">
      {children}
      <div className="wz-btns">
        {onBack && (
          <button className="btn ghost wz-back" onClick={onBack}>
            <Icon name="right" size={18} /> قبلی
          </button>
        )}
        {next.href ? (
          <a className="btn grow" href={next.href} target="_blank" rel="noreferrer">{next.label}</a>
        ) : (
          <button className="btn grow" onClick={next.onClick} disabled={next.disabled}>{next.label}</button>
        )}
        {extra}
      </div>
    </div>
  );
}

/** A big tappable answer: radio for one choice, checkbox for several. */
export function Choice({ on, onClick, title, sub, icon, multi, aside }: {
  on: boolean;
  onClick: () => void;
  title: ReactNode;
  sub?: ReactNode;
  icon?: string;
  multi?: boolean;
  aside?: ReactNode;
}) {
  return (
    <button className={"wz-opt" + (on ? " on" : "")} onClick={onClick} role={multi ? "checkbox" : "radio"} aria-checked={on}>
      <span className={(multi ? "selbox" : "radio") + (on ? " on" : "")}>{on && (multi ? <Icon name="check" size={14} stroke={2.6} /> : <i />)}</span>
      {icon && <span className="wz-opt-ico"><Icon name={icon} size={20} /></span>}
      <span className="grow wz-opt-txt">
        <span className="wz-opt-t">{title}</span>
        {sub && <span className="meta">{sub}</span>}
      </span>
      {aside}
    </button>
  );
}
