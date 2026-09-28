import { useEffect, type MouseEvent } from "react";
import { ArrowRight, Check, Flame, Footprints, LogIn, Play, Route, TrendingUp, UserPlus } from "lucide-react";
import "./landing.css";
import DesktopLanding from "./DesktopLanding";
import { native, localWeb } from "./platform";
import SpatialGuardMark from "./SpatialGuardMark";
import CameraMark from "./CameraMark";

function Brand() {
  return (
    <span className="sg-entry-brand">
      <span className="sg-entry-brand-mark"><SpatialGuardMark size={24} /></span>
      Pathlight
    </span>
  );
}

export default function Landing() {
  const deletionReceipt = sessionStorage.getItem("spatialguard_deletion_receipt");
  const workspaceHref = native ? "/?workspace=1" : "/workspace";
  const hostedWeb = !native && !localWeb;
  const accountRequired = hostedWeb || native;
  const previewLabel = accountRequired ? "Private account required" : "Local demo: no account required";
  const openAuth = (mode: "signin" | "signup") =>
    window.location.assign(native ? `/?auth=${mode}` : `/${mode}`);
  const openWorkspace = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!accountRequired) return;
    event.preventDefault();
    openAuth("signin");
  };

  useEffect(() => {
    document.title = "Pathlight — See where people go";
    window.scrollTo({ top: 0, left: 0 });
  }, []);

  return (
    <>
      {deletionReceipt && <div className="deletion-receipt" role="status"><Check size={17} /><span><strong>Account deletion completed</strong><small>Receipt {deletionReceipt}. Save this non-sensitive reference for your records.</small></span><button aria-label="Dismiss deletion receipt" onClick={(event) => { sessionStorage.removeItem("spatialguard_deletion_receipt"); event.currentTarget.parentElement?.remove(); }}>×</button></div>}
      <DesktopLanding
        hostedWeb={accountRequired}
        openSignIn={() => openAuth("signin")}
        openSignUp={() => openAuth("signup")}
        openWorkspace={openWorkspace}
        workspaceHref={workspaceHref}
      />
      <div className="sg-entry sg-mobile-entry">
      <section className="sg-mobile-welcome" aria-labelledby="sg-mobile-title">
        <div className="sg-mobile-glow sg-mobile-glow-one" />
        <div className="sg-mobile-glow sg-mobile-glow-two" />

        <header className="sg-mobile-brand">
          <span className="sg-mobile-brand-mark"><SpatialGuardMark size={27} /></span>
          <span>Pathlight</span>
        </header>

        <div className="sg-mobile-scene" aria-label="A shop whose cameras map foot traffic">
          <span className="sg-mobile-status"><span /> Live foot traffic</span>
          <svg viewBox="0 0 320 230" role="img" aria-label="A shop with two cameras, a visitor path and a heatmap glow at the entrance">
            <defs>
              <linearGradient id="sg-house-face" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="1" stopColor="#e8e8f8" />
              </linearGradient>
              <radialGradient id="sg-heat">
                <stop offset="0" stopColor="#e5322d" stopOpacity=".9" />
                <stop offset=".38" stopColor="#ff8a1f" stopOpacity=".65" />
                <stop offset=".66" stopColor="#ffd640" stopOpacity=".35" />
                <stop offset="1" stopColor="#42aaff" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="sg-roof-face" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#272a49" />
                <stop offset="1" stopColor="#42466e" />
              </linearGradient>
            </defs>
            <ellipse className="sg-mobile-lawn" cx="160" cy="203" rx="132" ry="18" />
            <path className="sg-mobile-walkway" d="M211 178h31l26 42h-83Z" />
            <path className="sg-mobile-home-shadow" d="M48 105 160 29l112 76v92H48Z" />
            <path className="sg-mobile-home" d="M52 101 160 30l108 71v94H52Z" />
            <path className="sg-mobile-roof" d="m36 105 124-84 124 84-13 12-111-74-111 74Z" />
            <path className="sg-mobile-chimney" d="M222 48h22v39l-22-15Z" />
            <path className="sg-mobile-siding" d="M56 116h208M56 129h208M56 142h208M56 155h208M56 168h208M56 181h208" />

            <g className="sg-mobile-shopfront">
              <rect x="68" y="120" width="80" height="75" rx="3" />
              <path d="M108 121v74M69 170h78" />
              <rect className="sg-mobile-open" x="80" y="132" width="40" height="15" rx="3" />
              <text x="100" y="143.2" textAnchor="middle">OPEN</text>
            </g>
            <path className="sg-mobile-awning" d="M62 104h196l-7 13H69Z" />
            <path className="sg-mobile-awning-stripes" d="M86 104l-3 13M110 104l-2 13M134 104l-1 13M158 104v13M182 104l1 13M206 104l2 13M230 104l3 13" />
            <g className="sg-mobile-window">
              <rect x="160" y="117" width="37" height="35" rx="2" />
              <path d="M178.5 118v33M161 134.5h35" />
            </g>
            <g className="sg-mobile-door">
              <rect x="207" y="112" width="35" height="83" rx="3" />
              <rect x="214" y="121" width="21" height="24" rx="2" />
              <circle cx="234" cy="165" r="2.4" />
              <path d="M201 195h48" />
            </g>
            <g className="sg-mobile-plant" transform="translate(257 174)">
              <path d="M0 17h20l-3 12H3Z" />
              <circle cx="4" cy="10" r="7" /><circle cx="11" cy="6" r="9" /><circle cx="18" cy="11" r="7" />
            </g>

            <path className="sg-mobile-coverage-cone" d="M235 93 304 67A76 76 0 0 1 309 145Z" />
            <path className="sg-mobile-coverage-cone" d="M55 137 8 112A69 69 0 0 0 10 177Z" />
            <path className="sg-mobile-path" d="M304 214c-30-8-48-21-55-30-13-16-31-10-52 1" />
            <g className="sg-mobile-camera" transform="translate(235 94)">
              <circle className="sg-camera-ring" r="12" />
              <circle className="sg-camera-dot" r="4.8" />
            </g>
            <g className="sg-mobile-camera" transform="translate(55 137)">
              <circle className="sg-camera-ring" r="12" />
              <circle className="sg-camera-dot" r="4.8" />
            </g>
            <g className="sg-mobile-heat" aria-hidden="true">
              <circle cx="226" cy="202" r="30" fill="url(#sg-heat)" />
              <circle cx="190" cy="206" r="20" fill="url(#sg-heat)" opacity=".7" />
              <circle cx="262" cy="210" r="16" fill="url(#sg-heat)" opacity=".55" />
            </g>
          </svg>
          <span className="sg-mobile-event"><Flame size={16} /> Busiest spot: entrance</span>
        </div>

        <div className="sg-mobile-sheet">
          <span className="sg-mobile-sheet-icon"><SpatialGuardMark size={26} /></span>
          <p className="sg-mobile-eyebrow">Welcome to Pathlight</p>
          <h1 id="sg-mobile-title">See where people go.<br /><span>Know what works.</span></h1>
          <p className="sg-mobile-intro">Heatmaps and visitor paths from the Ring cameras you already have.</p>
          <div className="sg-mobile-actions">
            <a className="sg-mobile-try" href={workspaceHref} onClick={openWorkspace}><Play size={17} fill="currentColor" />Try it out</a>
            <div>
              <button onClick={() => openAuth("signin")}><LogIn size={16} />Sign in</button>
              <button onClick={() => openAuth("signup")}><UserPlus size={16} />Sign up</button>
            </div>
          </div>
          <small>{previewLabel}</small>
        </div>
      </section>

      <header className="sg-entry-nav">
        <Brand />
        <div className="sg-entry-auth" aria-label="Account access">
          <button onClick={() => openAuth("signin")}><LogIn size={16} />Sign in</button>
          <button className="sg-entry-signup" onClick={() => openAuth("signup")}><UserPlus size={16} />Create account</button>
        </div>
      </header>

      <main className="sg-entry-main">
        <section className="sg-entry-copy" aria-labelledby="sg-entry-title">
          <div className="sg-entry-kicker"><Footprints size={17} />Foot-traffic analytics for Ring cameras</div>
          <h1 id="sg-entry-title">See where people go.<br /><span>Know what works.</span></h1>
          <p>Pathlight turns your Ring cameras into a live map of how customers move through your space: heatmaps, visitor paths and busy hours on your own floor plan.</p>
          <div className="sg-entry-actions">
            <a className="sg-entry-primary" href={workspaceHref} onClick={openWorkspace}><Play size={17} fill="currentColor" />Try it out</a>
            <button onClick={() => openAuth("signup")}>Create account <ArrowRight size={17} /></button>
          </div>
          <div className="sg-entry-benefits" aria-label="Pathlight benefits">
            <span><Flame size={17} />Live people heatmaps</span>
            <span><Route size={17} />Visitor paths across cameras</span>
            <span><TrendingUp size={17} />Peak hours and busy zones</span>
          </div>
        </section>

        <section className="sg-entry-visual" aria-label="Pathlight foot-traffic overview">
          <header>
            <div><strong>Store overview</strong><span>Illustrative example</span></div>
            <span className="sg-entry-protected"><Check size={14} />Live traffic</span>
          </header>

          <div className="sg-entry-map">
            <svg viewBox="0 0 680 430" role="img" aria-label="Store floor plan with two cameras, a visitor path and a foot-traffic heatmap">
              <defs>
                <radialGradient id="sg-entry-heat">
                  <stop offset="0" stopColor="#e5322d" stopOpacity=".85" />
                  <stop offset=".38" stopColor="#ff8a1f" stopOpacity=".6" />
                  <stop offset=".66" stopColor="#ffd640" stopOpacity=".32" />
                  <stop offset="1" stopColor="#42aaff" stopOpacity="0" />
                </radialGradient>
              </defs>
              <rect className="sg-entry-ground" x="0" y="0" width="680" height="430" />
              <path className="sg-entry-coverage" d="M540 76 L660 20 A170 170 0 0 1 666 184 Z" />
              <path className="sg-entry-coverage" d="M80 338 L4 420 A155 155 0 0 0 206 426 Z" />
              <g className="sg-entry-floor">
                <rect x="164" y="70" width="176" height="145" />
                <rect x="164" y="215" width="176" height="145" />
                <rect x="340" y="70" width="154" height="290" />
                <rect x="494" y="70" width="130" height="145" />
                <line x1="164" y1="215" x2="624" y2="215" />
              </g>
              <g className="sg-entry-heat" aria-hidden="true">
                <circle cx="548" cy="176" r="58" fill="url(#sg-entry-heat)" />
                <circle cx="420" cy="258" r="62" fill="url(#sg-entry-heat)" opacity=".85" />
                <circle cx="252" cy="300" r="46" fill="url(#sg-entry-heat)" opacity=".6" />
                <circle cx="260" cy="140" r="34" fill="url(#sg-entry-heat)" opacity=".4" />
              </g>
              <g className="sg-entry-room-labels">
                <text x="252" y="145">Stockroom</text>
                <text x="252" y="292">Café seating</text>
                <text x="417" y="145">Aisles</text>
                <text x="417" y="292">Checkout</text>
                <text x="559" y="145">Entrance</text>
              </g>
              <path className="sg-entry-route" d="M610 46 C570 88 542 126 548 168 C554 205 516 232 464 248" />
              <g className="sg-entry-person" transform="translate(474 241)">
                <circle cx="0" cy="0" r="13" />
              </g>
              <g className="sg-entry-camera" transform="translate(540 77)">
                <circle className="sg-camera-ring" r="13" />
                <circle className="sg-camera-dot" r="5.2" />
              </g>
              <g className="sg-entry-camera" transform="translate(80 338)">
                <circle className="sg-camera-ring" r="13" />
                <circle className="sg-camera-dot" r="5.2" />
              </g>
            </svg>

            <article className="sg-entry-camera-card">
              <span className="sg-entry-camera-thumb"><CameraMark size={20} /></span>
              <span><strong>Entrance camera</strong><small>Live available</small></span>
              <span className="sg-entry-live">Live</span>
            </article>

            <article className="sg-entry-incident">
              <span className="sg-entry-incident-icon"><TrendingUp size={22} /></span>
              <span><small>Traffic insight</small><strong>Busiest hour: 12–1 PM at the entrance</strong></span>
              <ArrowRight size={18} />
            </article>
          </div>
        </section>
      </main>

      <footer className="sg-entry-footer">
        <span>{hostedWeb ? "Cloud service" : "Local replay"}</span>
        <span className="landing-legal-links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/data-deletion">Data deletion</a></span>
        <span>Built with TwinForge</span>
      </footer>
      </div>
    </>
  );
}
