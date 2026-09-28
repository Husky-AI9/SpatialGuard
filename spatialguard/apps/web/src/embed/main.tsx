import { createRoot } from "react-dom/client";
import "@fontsource/source-sans-pro/latin-400.css";
import "@fontsource/source-sans-pro/latin-600.css";
import "@fontsource/source-sans-pro/latin-700.css";
import "../style.css";
import "./embed.css";
import MapEmbed from "./MapEmbed";

createRoot(document.getElementById("root")!).render(<MapEmbed />);
