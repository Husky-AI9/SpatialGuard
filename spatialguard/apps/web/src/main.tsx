import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/source-sans-pro/400.css";
import "@fontsource/source-sans-pro/600.css";
import "@fontsource/source-sans-pro/700.css";
import App from "./App";
import Landing from "./Landing";
import "./style.css";
import { native } from "./platform";
const path = window.location.pathname.replace(/\/$/, "");
const nativeWorkspaceRequested = new URLSearchParams(window.location.search).has("workspace");
const localBrowser = ["127.0.0.1", "localhost"].includes(window.location.hostname);
const workspaceRequested = path === "/workspace" || (native && nativeWorkspaceRequested);
const isLanding = path === "/landing" || (native && !nativeWorkspaceRequested) || (!native && !localBrowser && !workspaceRequested);
document.body.classList.toggle("landing-body", isLanding);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isLanding ? <Landing /> : <App />}
  </React.StrictMode>,
);
if (!native && !isLanding && "serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
