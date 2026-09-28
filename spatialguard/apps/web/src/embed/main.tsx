import { createRoot } from "react-dom/client";
import "@fontsource/source-sans-pro/latin-400.css";
import "@fontsource/source-sans-pro/latin-600.css";
import "@fontsource/source-sans-pro/latin-700.css";
import "../style.css";
import "./embed.css";
import MapEmbed from "./MapEmbed";
import AnalyticsEmbed from "./AnalyticsEmbed";

declare global {
  interface Window {
    /** Set by the native app before the page loads: which view this WebView shows. */
    __sgKind?: "map" | "analytics";
  }
}

createRoot(document.getElementById("root")!).render(window.__sgKind === "analytics" ? <AnalyticsEmbed /> : <MapEmbed />);
