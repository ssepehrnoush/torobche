import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "vazirmatn/Vazirmatn-Variable-font-face.css";
import "./styles.css";
import App from "./App";
import Wizard from "./Wizard";

// The step-by-step wizard is the default; ?classic opens the original chat UI for comparison.
const classic = new URLSearchParams(window.location.search).has("classic");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {classic ? <App /> : <Wizard />}
  </StrictMode>
);
