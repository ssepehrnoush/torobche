import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fa } from "../../fmt";
import { Icon } from "../../icons";

/* How a shop hears about the question, as three very short animated scenes: Torob's AI (the radish with a
   headset) phoning the shopkeeper, with the real automated call playing; a WhatsApp message and its answer; a text
   message from the radish's phone and its answer. A shop gets only the ways it picked in the seller panel, in its
   order, so a real user sees the first of them; the demo shows all three, one after another. */

type Way = "call" | "whatsapp" | "sms";
const NAME: Record<Way, string> = { call: "تماس هوش مصنوعی", whatsapp: "واتساپ", sms: "پیامک" };
const ICON: Record<Way, string> = { call: "phone", whatsapp: "chat", sms: "send" };
const LEN: Record<Way | "intro", number> = { intro: 5.2, call: 21, whatsapp: 7, sms: 7 };
const RING = 1.4; // the phone rings this long before the shopkeeper picks up
const AI_SECS = 16.0; // the call's own recording, /reach/call-ai.mp3
const SELLER_AT = RING + AI_SECS + 0.35;
const CALL_LINES = [
  "سلام، وقت بخیر. از هوش مصنوعی تربچه تماس می‌گیریم.",
  "یک مشتری نزدیک فروشگاه شما، هدفون بی‌سیم شیائومی را می‌خواهد.",
  "لینک جواب برایتان پیامک شد؛ با یک لمس روی آن بگویید موجود دارید یا نه. ممنون.",
];

/** Which of the call's sentences is being said at `t` seconds into the recording: by their share of its letters. */
function sentenceAt(t: number): number {
  const total = CALL_LINES.reduce((s, l) => s + l.length, 0);
  let acc = 0;
  for (let i = 0; i < CALL_LINES.length; i++) {
    acc += (CALL_LINES[i].length / total) * AI_SECS;
    if (t < acc) return i;
  }
  return CALL_LINES.length - 1;
}

const img = (n: string) => `/reach/${n}.webp`;

function CallScene({ t }: { t: number }) {
  const talking = t >= RING && t < SELLER_AT + 2.4;
  const done = t >= SELLER_AT + 2.4;
  const said = t >= RING ? sentenceAt(Math.min(t - RING, AI_SECS - 0.01)) : -1;
  const secs = Math.max(0, Math.floor(t - RING));
  return (
    <div className={"rs-stage call" + (t >= RING ? " up" : " ringing")}>
      <div className="rs-status">
        <span className={"rs-dot" + (done ? " ok" : "")} />
        {t < RING ? "داره زنگ می‌زنه…" : done ? "تماس تمام شد" : `در حال مکالمه · ${fa(Math.floor(secs / 60))}:${fa(String(secs % 60).padStart(2, "0"))}`}
      </div>
      <div className="rs-bubbles">
        {said >= 0 && t < SELLER_AT + 0.2 && <div key={said} className="rs-say ai">{CALL_LINES[said]}</div>}
        {t >= SELLER_AT && <div className="rs-say shop">چشم، همین الان جواب می‌دم!</div>}
      </div>
      <div className="rs-cast">
        <figure className="rs-who me"><img src={img("torob_ai")} alt="هوش مصنوعی ترب" /><figcaption>هوش مصنوعی ترب</figcaption></figure>
        <div className={"rs-line" + (talking ? " live" : "")}>
          {t < RING ? <span className="rs-phone"><Icon name="phone" size={18} /></span> : <span className="rs-wave">{[0, 1, 2, 3, 4, 5, 6].map((i) => <i key={i} />)}</span>}
        </div>
        <figure className="rs-who shop">
          <img src={img(t < RING ? "seller_phone" : "seller_call")} alt="مغازه‌دار" />
          {t < RING && <><em className="rs-ring r1" /><em className="rs-ring r2" /></>}
          <figcaption>مغازه‌دار</figcaption>
        </figure>
      </div>
    </div>
  );
}

function ChatScene({ way, t, text }: { way: "whatsapp" | "sms"; t: number; text: string }) {
  const sent = t >= 0.9, read = t >= 2.3, typing = t >= 2.7 && t < 4.0, reply = t >= 4.0;
  const answer = way === "whatsapp" ? "سلام، بله موجوده. بفرستید بیاد!" : "موجوده، تا ۹ شب هم هستیم.";
  return (
    <div className={`rs-stage ${way}`}>
      <div className="rs-status"><span className={"rs-dot" + (reply ? " ok" : "")} />{reply ? "جواب رسید" : sent ? (way === "whatsapp" ? "پیام واتساپ رفت" : "پیامک رفت") : "در حال فرستادن…"}</div>
      <div className={`rs-chat ${way}`}>
        {sent && (
          <div className="rs-msg out">
            {way === "sms" && <b className="rs-from">هوش مصنوعی لمون</b>}
            <span>{text}</span>
            <small>{fa("11:02")}{way === "whatsapp" && <i className={"rs-ticks" + (read ? " read" : "")}>✓✓</i>}</small>
          </div>
        )}
        {typing && <div className="rs-msg in typing"><i /><i /><i /></div>}
        {reply && <div className="rs-msg in"><span>{answer}</span><small>{fa("11:03")}</small></div>}
      </div>
      <div className="rs-cast">
        <figure className={"rs-who me " + way}><img src={img(way === "whatsapp" ? "whatsapp" : "sms_phone")} alt={way === "whatsapp" ? "واتساپ" : "پیامک از گوشی ترب"} /><figcaption>{way === "whatsapp" ? "واتساپ" : "پیامک ترب"}</figcaption></figure>
        <div className="rs-line live">
          {!sent && <span className="rs-fly out"><Icon name={way === "whatsapp" ? "chat" : "send"} size={16} /></span>}
          {reply && t < 4.9 && <span className="rs-fly back"><Icon name="chat" size={16} /></span>}
        </div>
        <figure className="rs-who shop"><img src={img("seller_phone")} alt="مغازه‌دار" /><figcaption>مغازه‌دار</figcaption></figure>
      </div>
    </div>
  );
}

export function ReachShow({ ways, shop, message, onDone }: { ways: Way[]; shop: string; message: string; onDone: () => void }) {
  const all = ways.length > 1;
  const scenes: (Way | "intro")[] = all ? ["intro", ...ways] : ways;
  const total = scenes.reduce((s, k) => s + LEN[k], 0);
  const [t, setT] = useState(0);
  const t0 = useRef(performance.now());
  const audio = useRef<{ ai?: HTMLAudioElement; seller?: HTMLAudioElement }>({});
  const played = useRef<Set<string>>(new Set());

  useEffect(() => {
    audio.current = { ai: new Audio("/reach/call-ai.mp3"), seller: new Audio("/reach/call-seller.mp3") };
    let raf = 0;
    const tick = () => {
      const now = (performance.now() - t0.current) / 1000;
      setT(now);
      if (now >= total) onDone();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); audio.current.ai?.pause(); audio.current.seller?.pause(); };
  }, []); // eslint-disable-line

  let start = 0, scene: Way | "intro" = scenes[0];
  for (const k of scenes) {
    if (t < start + LEN[k]) { scene = k; break; }
    start += LEN[k];
  }
  const lt = t - start;
  // the call's recording plays with the scene (the person tapped «بفرست» just now, so the browser allows sound)
  const phase = scene === "call" ? (lt < RING ? "ring" : lt < SELLER_AT ? "talk" : "answer") : scene;
  useEffect(() => {
    const play = (k: "ai" | "seller") => {
      if (played.current.has(k)) return;
      played.current.add(k);
      audio.current[k]?.play().catch(() => null);
    };
    if (phase === "talk") play("ai");
    if (phase === "answer") play("seller");
  }, [phase]);

  return createPortal(
    <div className="reach" data-scene={scene} data-phase={phase} role="dialog" aria-label="خبر دادن به مغازه‌دار">
      <div className="rs-top">
        <div className="rs-steps">
          {scenes.filter((k) => k !== "intro").map((k) => {
            const i = scenes.indexOf(k), s0 = scenes.slice(0, i).reduce((a, x) => a + LEN[x], 0);
            const f = Math.max(0, Math.min(1, (t - s0) / LEN[k]));
            return <span key={k} className={"rs-step" + (k === scene ? " on" : "")}><i style={{ width: `${f * 100}%` }} /><b><Icon name={ICON[k]} size={13} /> {NAME[k]}</b></span>;
          })}
        </div>
        <button className="textbtn" onClick={onDone}>رد شو</button>
      </div>
      <div className="rs-body">
        {scene === "intro" && (
          <div className="rs-intro">
            <h2>مغازه‌دار از کدوم راه خبردار می‌شه؟</h2>
            <div className="rs-chips">
              {ways.map((w, i) => <span key={w} className={"rs-chip " + w} style={{ animationDelay: `${0.3 + i * 0.45}s` }}><Icon name={ICON[w]} size={16} /> {fa(i + 1)}. {NAME[w]}</span>)}
            </div>
            <p>هر مغازه‌دار از قبل در پنل ترب انتخاب کرده از کدام راه‌ها و به چه ترتیبی خبرش کنیم، و فقط همان را می‌گیرد. اینجا برای نمایش هر سه را پشت هم می‌بینی.</p>
          </div>
        )}
        {scene === "call" && <CallScene t={lt} />}
        {(scene === "whatsapp" || scene === "sms") && <ChatScene key={scene} way={scene} t={lt} text={message} />}
        {!all && <p className="rs-note">«{shop}» خواسته اول از راه {NAME[ways[0]]} خبرش کنیم.</p>}
      </div>
    </div>,
    document.body,
  );
}
