import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../../icons";
import { record, stopSpeaking, transcribe, voiceSupported, type Recording } from "../../voice";

/** Tap to talk: listens until a pause, the server writes it down, the text is handed over. Tap again to finish early. */
export function MicButton({ onText, toast, onStart, disabled }: {
  onText: (t: string) => void;
  toast: (s: string) => void;
  onStart?: () => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<"idle" | "listening" | "thinking">("idle");
  const [level, setLevel] = useState(0);
  const rec = useRef<Recording | null>(null);
  useEffect(() => () => rec.current?.cancel(), []);
  if (!voiceSupported()) return null;

  const click = async () => {
    if (state === "listening") return rec.current?.stop();
    if (state !== "idle") return;
    stopSpeaking();
    onStart?.();
    try {
      rec.current = await record(setLevel);
    } catch (e: any) {
      toast(e?.name === "NotAllowedError" ? "اجازهٔ میکروفون داده نشده؛ از تنظیمات مرورگر اجازه بدهید یا تایپ کنید" : "میکروفون در دسترس نیست؛ لطفاً تایپ کنید");
      return;
    }
    setState("listening");
    const wav = await rec.current.done;
    rec.current = null;
    setLevel(0);
    if (!wav) {
      setState("idle");
      toast("صدایی نشنیدم؛ دوباره میکروفون را بزنید و حرف بزنید");
      return;
    }
    setState("thinking");
    try {
      const t = (await transcribe(wav)).trim();
      if (t) onText(t);
      else toast("صدایی نشنیدم؛ دوباره میکروفون را بزنید و حرف بزنید");
    } catch {
      toast("صدا به متن تبدیل نشد؛ دوباره امتحان کنید یا تایپ کنید");
    }
    setState("idle");
  };

  return (
    <button type="button" className={"micbtn wz-mic" + (state === "listening" ? " rec" : state === "thinking" ? " busy" : "")}
      onClick={click} disabled={disabled || state === "thinking"} style={{ "--lv": level } as CSSProperties}
      aria-label={state === "listening" ? "تمام شد، بفرست" : state === "thinking" ? "در حال تبدیل صدا به متن" : "با صدا بگو"}>
      {state === "thinking" ? <span className="wz-spin sm" /> : <Icon name="mic" size={20} />}
    </button>
  );
}
