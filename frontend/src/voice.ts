/* Talking with the assistant in the browser: record 16 kHz WAV until the person pauses, send it to /api/voice/stt,
   and play /api/voice/tts as it streams in. No browser speech service is used (Google's is not reachable from Iran). */

const RATE = 16000; // what the recording is resampled to before upload
const TTS_RATE = 24000; // pcm16 mono from /api/voice/tts
const PAUSE_MS = 1200; // this much quiet after speech ends the recording
const NO_SPEECH_MS = 6000; // give up if nothing was said
const MAX_MS = 20000;

let ctx: AudioContext | null = null;

/** One shared AudioContext, created or resumed inside a tap so phones (iOS above all) let it play later. */
export function audio(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export const voiceSupported = () => !!navigator.mediaDevices?.getUserMedia && !!(window.AudioContext || (window as any).webkitAudioContext);

export type Recording = { stop: () => void; cancel: () => void; done: Promise<Blob | null> };

/** Start recording; `done` gives a WAV once the person stops talking (or null if nothing was said). */
export async function record(onLevel?: (v: number) => void): Promise<Recording> {
  const ac = audio();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const src = ac.createMediaStreamSource(stream);
  const proc = ac.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  const t0 = performance.now();
  let floor = 0.01; // background level, learned while nobody speaks
  let heard = false;
  let quietSince = 0;
  let finished = false;
  let resolve!: (b: Blob | null) => void;
  const done = new Promise<Blob | null>((r) => (resolve = r));
  // the checks below run on audio callbacks; if the phone never delivers audio, this still ends the recording
  const guard = window.setTimeout(() => finish(heard), MAX_MS + 1000);
  const finish = (keep: boolean) => {
    if (finished) return;
    finished = true;
    window.clearTimeout(guard);
    proc.onaudioprocess = null;
    proc.disconnect();
    src.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    const seconds = chunks.length * 4096 / ac.sampleRate;
    resolve(keep && seconds > 0.4 ? wav(chunks, ac.sampleRate) : null);
  };
  proc.onaudioprocess = (e) => {
    const x = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(x));
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    const rms = Math.sqrt(sum / x.length);
    onLevel?.(Math.min(1, rms / 0.15));
    const now = performance.now();
    if (rms > Math.max(0.015, floor * 2.5)) {
      heard = true;
      quietSince = 0;
    } else {
      floor = floor * 0.9 + rms * 0.1;
      if (heard) {
        quietSince ||= now;
        if (now - quietSince > PAUSE_MS) finish(true);
      }
    }
    if (!heard && now - t0 > NO_SPEECH_MS) finish(false);
    if (now - t0 > MAX_MS) finish(true);
  };
  src.connect(proc);
  proc.connect(ac.destination); // a script processor only runs while connected; it outputs silence
  return { stop: () => finish(true), cancel: () => finish(false), done };
}

/** Mono 16-bit WAV at RATE; each output sample averages the input samples it covers (a cheap low-pass). */
function wav(chunks: Float32Array[], rate: number): Blob {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(len);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  const ratio = rate / RATE;
  const n = Math.floor(len / ratio);
  const v = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.max(a + 1, Math.min(len, Math.floor((i + 1) * ratio)));
    let s = 0;
    for (let j = a; j < b; j++) s += all[j];
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s / (b - a))) * 0x7fff, true);
  }
  return new Blob([v.buffer], { type: "audio/wav" });
}

export async function transcribe(rec: Blob): Promise<string> {
  const r = await fetch("/api/voice/stt", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: rec });
  if (!r.ok) throw new Error(`stt ${r.status}`);
  return ((await r.json()).text as string) || "";
}

let playing: { stop: () => void } | null = null;

export function stopSpeaking() {
  playing?.stop();
  playing = null;
}

/** Read a sentence aloud, starting as soon as the first audio arrives. `onState` says when it starts and ends. */
export async function speak(text: string, onState?: (on: boolean) => void) {
  stopSpeaking();
  const ac = audio();
  const ctrl = new AbortController();
  const sources: AudioBufferSourceNode[] = [];
  let at = 0;
  let ended = false;
  let timer = 0;
  const end = () => {
    if (ended) return;
    ended = true;
    window.clearTimeout(timer);
    if (playing === me) playing = null;
    onState?.(false);
  };
  const me = {
    stop: () => {
      ctrl.abort();
      sources.forEach((s) => { try { s.stop(); } catch { /* not started */ } });
      end();
    },
  };
  playing = me;
  onState?.(true);
  const play = (bytes: Uint8Array) => {
    const n = bytes.length >> 1;
    if (!n) return;
    const buf = ac.createBuffer(1, n, TTS_RATE);
    const ch = buf.getChannelData(0);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
    for (let i = 0; i < n; i++) ch[i] = dv.getInt16(i * 2, true) / 32768;
    const s = ac.createBufferSource();
    s.buffer = buf;
    s.connect(ac.destination);
    at = Math.max(at, ac.currentTime + 0.03);
    s.start(at);
    at += buf.duration;
    sources.push(s);
  };
  try {
    const r = await fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: ctrl.signal });
    if (!r.ok || !r.body) throw new Error(`tts ${r.status}`);
    const reader = r.body.getReader();
    let held = new Uint8Array(0);
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const joined = new Uint8Array(held.length + value.length);
      joined.set(held);
      joined.set(value, held.length);
      if (joined.length < TTS_RATE / 2) { // gather a quarter second before scheduling, so playback has no gaps
        held = joined;
        continue;
      }
      const even = joined.length & ~1;
      play(joined.subarray(0, even));
      held = joined.slice(even);
    }
    play(held);
    timer = window.setTimeout(end, Math.max(0, (at - ac.currentTime) * 1000) + 100);
  } catch {
    end();
  }
}
