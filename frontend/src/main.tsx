import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "vazirmatn/Vazirmatn-Variable-font-face.css";
import "./styles.css";
import App from "./App";
import ShopReply from "./ShopReply";
import type { Ctx } from "./types";
import Wizard from "./Wizard";

const Mall3D = lazy(() => import("./components/mall3d/Mall3D"));

// The step-by-step wizard is the default; ?classic opens the original chat UI for comparison.
// /r/<token> is the shop's one-tap answer page, opened from the inquiry text message.
const classic = new URLSearchParams(window.location.search).has("classic");
const reply = window.location.pathname.match(/^\/r\/([\w-]+)/);
// ?mall3d=<shop id>[&pid=<product>] opens a shop's mall in 3D by itself (for trying the model directly)
const q = new URLSearchParams(window.location.search);
const m3d = Number(q.get("mall3d")) || 0;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {reply ? <ShopReply token={reply[1]} /> : m3d ? (
      <Suspense fallback={null}><Mall3D sid={m3d} pid={Number(q.get("pid")) || null} ctx={{} as Ctx} onClose={() => window.location.assign("/")} /></Suspense>
    ) : classic ? <App /> : <Wizard />}
  </StrictMode>
);
