import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "vazirmatn/Vazirmatn-Variable-font-face.css";
import "./styles.css";
import App from "./App";
import ShopReply from "./ShopReply";
import Wizard from "./Wizard";


// The step-by-step wizard is the default; ?classic opens the original chat UI for comparison.
// /r/<token> is the shop's one-tap answer page, opened from the inquiry text message.
const classic = new URLSearchParams(window.location.search).has("classic");
const reply = window.location.pathname.match(/^\/r\/([\w-]+)/);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {reply ? <ShopReply token={reply[1]} /> : classic ? <App /> : <Wizard />}
  </StrictMode>
);
