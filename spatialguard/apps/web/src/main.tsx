import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/source-sans-pro/400.css";
import "@fontsource/source-sans-pro/600.css";
import "@fontsource/source-sans-pro/700.css";
import App from "./App";
import Landing from "./Landing";
import AuthPage from "./AuthPage";
import LegalPage from "./LegalPage";
import "./style.css";
import { installAppLinkNavigation, native } from "./platform";
if (native) void installAppLinkNavigation();
const path = window.location.pathname.replace(/\/$/, "");
const authQuery = new URLSearchParams(window.location.search).get("auth");
const authMode = path === "/verify-email" ? "verify"
  : path === "/forgot-password" ? "forgot"
  : path === "/reset-password" ? "reset"
  : path === "/signin" || authQuery === "signin"
  ? "signin"
  : path === "/signup" || authQuery === "signup" ? "signup" : null;
const nativeWorkspaceRequested = new URLSearchParams(window.location.search).has("workspace");
const localBrowser = ["127.0.0.1", "localhost"].includes(window.location.hostname);
const workspaceRequested = path === "/workspace" || (native && nativeWorkspaceRequested);
const legalKind = (["/privacy", "/terms", "/data-deletion"] as const).find(route => path === route)?.slice(1) as "privacy" | "terms" | "data-deletion" | undefined;
const isLanding = !legalKind && !authMode && (path === "/landing" || (native && !nativeWorkspaceRequested) || (!native && !localBrowser && !workspaceRequested));
document.body.classList.toggle("landing-body", isLanding || !!authMode || !!legalKind);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {legalKind ? <LegalPage kind={legalKind} /> : authMode ? <AuthPage mode={authMode as "signin" | "signup" | "forgot" | "reset" | "verify"} /> : isLanding ? <Landing /> : <App />}
  </React.StrictMode>,
);
if (!native && !isLanding && !legalKind && "serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
