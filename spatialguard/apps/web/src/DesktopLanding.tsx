import { useState, type MouseEvent } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Camera,
  Check,
  Eye,
  Map,
  PackageCheck,
  Pause,
  Play,
  Route,
  Shield,
} from "lucide-react";
import landingHouse from "./assets/landing-house.png";
import LandingDemo from "./LandingDemo";

type Props = {
  hostedWeb: boolean;
  openSignIn: () => void;
  openSignUp: () => void;
  openWorkspace: (event: MouseEvent<HTMLAnchorElement>) => void;
  workspaceHref: string;
};

const chapters = [
  { label: "Place cameras", icon: Camera },
  { label: "See coverage", icon: Eye },
  { label: "Follow activity", icon: Route },
  { label: "Review evidence", icon: PackageCheck },
];

function Brand() {
  return (
    <span className="lp-brand">
      <span className="lp-brand-mark"><Shield size={19} /></span>
      SpatialGuard <span className="lp-brand-dot">●</span>
    </span>
  );
}

export default function DesktopLanding({
  hostedWeb,
  openSignIn,
  openSignUp,
  openWorkspace,
  workspaceHref,
}: Props) {
  const [chapter, setChapter] = useState(2);
  const [moving, setMoving] = useState(true);

  return (
    <div className={`lp lp-desktop lp-chapter-${chapter} ${moving ? "lp-moving" : ""}`}>
      <a className="lp-skip" href="#features">Skip to features</a>
      <section className="lp-first-fold" aria-labelledby="lp-title">
        <header className="lp-nav">
          <Brand />
          <nav aria-label="Landing page">
            <a href="#demo">See it in action</a>
            <a href="#features">Features</a>
            <a href="#why">Why SpatialGuard</a>
          </nav>
          <a className="lp-nav-cta" href={workspaceHref} onClick={openWorkspace}>
            Open workspace <ArrowUpRight size={15} />
          </a>
        </header>

        <div className="lp-hero">
          <div className="lp-copy">
            <p className="lp-intro"><span className="lp-intro-line" />A spatial view of home security</p>
            <h1 id="lp-title">See what happened.<br /><em>Know where.</em></h1>
            <p className="lp-description">Your cameras become one connected view of the home, the event, and the evidence.</p>
            <p className="lp-description-detail">SpatialGuard places camera coverage, estimated movement, and incident history on the same 2D or 3D map.</p>
            <div className="lp-actions">
              <a className="lp-primary" href={workspaceHref} onClick={openWorkspace}>
                <span><Play size={15} fill="currentColor" /></span>Try SpatialGuard
              </a>
              <button className="lp-tour" onClick={() => document.querySelector("#demo")?.scrollIntoView({ behavior: "smooth" })}>
                See the replay <ArrowRight size={15} />
              </button>
            </div>
            <button className="lp-local-note" onClick={openSignIn}>
              {hostedWeb ? "Private workspace · email sign-in required" : "Local replay preview · no account required"}
            </button>
          </div>

          <div className="lp-visual" aria-label="Illustrative 3D home protected by four cameras">
            <div className="lp-house-perspective">
              <div className="lp-house-float">
                <div className="lp-house-shadow" />
                <img className="lp-house" src={landingHouse} alt="Illustrative cutaway 3D home" />
                <div className="lp-house-overlay" aria-hidden="true">
                  <svg className="lp-guard-cameras" viewBox="0 0 1400 1045">
                    <path className="lp-guard-ring" d="M250 640 40 535A235 235 0 0 0 25 790Z" />
                    <path className="lp-guard-range" d="M250 640 40 535A235 235 0 0 0 25 790Z" />
                    <line className="lp-guard-beam" x1="250" y1="640" x2="54" y2="658" />

                    <path className="lp-guard-ring" d="M1040 250 1265 125A255 255 0 0 1 1365 365Z" />
                    <path className="lp-guard-range" d="M1040 250 1265 125A255 255 0 0 1 1365 365Z" />
                    <line className="lp-guard-beam" x1="1040" y1="250" x2="1305" y2="250" />

                    <path className="lp-guard-ring" d="M645 805 485 1010A260 260 0 0 0 865 1030Z" />
                    <path className="lp-guard-range" d="M645 805 485 1010A260 260 0 0 0 865 1030Z" />
                    <line className="lp-guard-beam" x1="645" y1="805" x2="675" y2="1010" />

                    <path className="lp-guard-ring" d="M790 510 675 380A190 190 0 0 1 940 420Z" />
                    <path className="lp-guard-range" d="M790 510 675 380A190 190 0 0 1 940 420Z" />
                    <line className="lp-guard-beam" x1="790" y1="510" x2="805" y2="388" />

                    {[
                      [250, 640, "Side yard"],
                      [1040, 250, "Back entry"],
                      [645, 805, "Front camera"],
                      [790, 510, "Hallway"],
                    ].map(([x, y, label]) => (
                      <g className="lp-guard-camera" transform={`translate(${x} ${y})`} key={String(label)}>
                        <circle className="lp-guard-disc" r="18" />
                        <Camera x={-9} y={-9} width={18} height={18} />
                        <text x="25" y="5">{label}</text>
                      </g>
                    ))}
                  </svg>
                  <svg className="lp-demo-route" viewBox="0 0 1400 1045">
                    <path d="M655 1012C650 940 647 875 645 805c-2-65 42-95 98-118 40-17 57-70 47-177" />
                    <circle cx="790" cy="510" r="10" />
                  </svg>
                </div>
              </div>
            </div>
            <div className="lp-visual-caption">
              <span>Illustrative home · product walkthrough</span>
              <button onClick={() => setMoving(value => !value)}>
                {moving ? <Pause size={12} /> : <Play size={12} />}{moving ? "Pause motion" : "Resume motion"}
              </button>
            </div>
          </div>

          <div className="lp-steps" aria-label="SpatialGuard workflow">
            {chapters.map(({ label, icon: Icon }, index) => (
              <button key={label} aria-pressed={chapter === index} onClick={() => setChapter(index)}>
                <span className="lp-step-box"><span>{label}</span><Icon size={16} /></span>
                <span className="lp-step-index">0{index + 1}<span className="lp-step-progress" /></span>
              </button>
            ))}
          </div>
          <a className="lp-scroll" href="#demo">A closer look <ArrowDown size={14} /></a>
        </div>
      </section>

      <LandingDemo />

      <section className="lp-explainer" id="features" aria-labelledby="lp-features-title">
        <div className="lp-section-intro">
          <span className="lp-section-number">01 / Features</span>
          <h2 id="lp-features-title">One event.<br /><em>One connected view.</em></h2>
          <p>Ring supplies the authorized camera evidence. SpatialGuard adds the home map, event sequence, camera context, and a review workflow.</p>
          <a href={workspaceHref} onClick={openWorkspace}>Open the workspace <ArrowRight size={16} /></a>
        </div>
        <div className="lp-feature-list">
          <details open><summary><span>01</span><h3>2D and 3D spatial context</h3><span className="lp-plus">+</span></summary><p>See where every mapped camera sits and which part of the home it covers.</p></details>
          <details><summary><span>02</span><h3>Chronological incident evidence</h3><span className="lp-plus">+</span></summary><p>Review observations, unknown gaps, and possible continuations without inventing a route.</p></details>
          <details><summary><span>03</span><h3>Live camera access</h3><span className="lp-plus">+</span></summary><p>Open a bounded, receive-only Ring stream from the camera card or camera wall.</p></details>
          <details><summary><span>04</span><h3>Camera uptime and operations</h3><span className="lp-plus">+</span></summary><p>See connectivity history, camera-wall layouts, and still-image time-lapse projects in one app.</p></details>
        </div>
      </section>

      <section className="lp-comparison" id="why" aria-labelledby="lp-why-title">
        <span className="lp-section-number">02 / Why SpatialGuard</span>
        <h2 id="lp-why-title">Camera evidence with<br /><em>the missing home context.</em></h2>
        <table>
          <caption>SpatialGuard uses authorized Ring capabilities and adds a spatial review layer.</caption>
          <thead><tr><th>Capability</th><th>Ring</th><th>SpatialGuard adds</th></tr></thead>
          <tbody>
            <tr><th>Live view</th><td>Open one authorized camera stream.</td><td><strong>Camera wall and map selection</strong>Open a camera from the same place you review its position and incidents.</td></tr>
            <tr><th>Motion events</th><td>Camera-specific event and clip history.</td><td><strong>Spatial incident timeline</strong>Group nearby camera events while preserving uncertain handoffs and unknown locations.</td></tr>
            <tr><th>Home awareness</th><td>Device names and individual camera views.</td><td><strong>2D and 3D home map</strong>Place cameras, show coverage, and pin every incident to the published layout revision.</td></tr>
          </tbody>
        </table>
        <p className="lp-comparison-note">The replay is synthetic. Live Ring events do not provide a calibrated person coordinate, so SpatialGuard does not invent one.</p>
      </section>

      <section className="lp-privacy" aria-labelledby="lp-privacy-title">
        <div><span className="lp-section-number">03 / Evidence boundaries</span><h2 id="lp-privacy-title">Clear about what is<br /><em>observed and unknown.</em></h2></div>
        <div className="lp-privacy-copy"><p>Every incident distinguishes observed evidence, a possible continuation, and a coverage gap. Live view is time-bounded and is not recorded as incident evidence by SpatialGuard.</p><a href={workspaceHref} onClick={openWorkspace}>Try the hosted preview <ArrowRight size={16} /></a></div>
      </section>

      <footer className="lp-footer">
        <Brand />
        <p>{hostedWeb ? "Hosted preview" : "Local replay preview"} · Built with TwinForge</p>
        <button onClick={openSignUp}>Create account <ArrowUpRight size={14} /></button>
      </footer>
    </div>
  );
}
