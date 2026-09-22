import { useEffect, type MouseEvent } from "react";
import {
  ArrowRight,
  Camera,
  Check,
  LogIn,
  Map,
  PackageCheck,
  Play,
  Route,
  Shield,
  UserPlus,
} from "lucide-react";
import "./landing.css";
import DesktopLanding from "./DesktopLanding";
import { native, localWeb } from "./platform";
import SpatialGuardMark from "./SpatialGuardMark";

function Brand() {
  return (
    <span className="sg-entry-brand">
      <span className="sg-entry-brand-mark"><SpatialGuardMark size={24} /></span>
      SpatialGuard
    </span>
  );
}

export default function Landing() {
  const deletionReceipt = sessionStorage.getItem("spatialguard_deletion_receipt");
  const workspaceHref = native ? "/?workspace=1" : "/workspace";
  const hostedWeb = !native && !localWeb;
  const accountRequired = hostedWeb || native;
  const previewLabel = accountRequired ? "Private account required" : "Local replay: no account required";
  const openAuth = (mode: "signin" | "signup") =>
    window.location.assign(native ? `/?auth=${mode}` : `/${mode}`);
  const openWorkspace = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!accountRequired) return;
    event.preventDefault();
    openAuth("signin");
  };

  useEffect(() => {
    document.title = "SpatialGuard — See what happened and where";
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

        <div className="sg-mobile-logo-stage" role="img" aria-label="SpatialGuard logo">
          <span className="sg-mobile-logo-mark"><SpatialGuardMark size={96} /></span>
          <strong>SpatialGuard</strong>
        </div>

        <div className="sg-mobile-sheet">
          <span className="sg-mobile-sheet-icon"><SpatialGuardMark size={26} /></span>
          <p className="sg-mobile-eyebrow">Welcome to SpatialGuard</p>
          <h1 id="sg-mobile-title">See what happened.<br /><span>Know where.</span></h1>
          <p className="sg-mobile-intro">Your cameras, movement, and evidence in one clear home view.</p>
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
          <div className="sg-entry-kicker"><Shield size={17} />Spatial awareness for your cameras</div>
          <h1 id="sg-entry-title">See what happened.<br /><span>Know where.</span></h1>
          <p>SpatialGuard places cameras, movement, and evidence on one home map so you can understand an event without switching between disconnected clips.</p>
          <div className="sg-entry-actions">
            <a className="sg-entry-primary" href={workspaceHref} onClick={openWorkspace}><Play size={17} fill="currentColor" />Try it out</a>
            <button onClick={() => openAuth("signup")}>Create account <ArrowRight size={17} /></button>
          </div>
          <div className="sg-entry-benefits" aria-label="SpatialGuard benefits">
            <span><Map size={17} />2D and 3D home context</span>
            <span><Route size={17} />Retained movement paths</span>
            <span><PackageCheck size={17} />Evidence-led review</span>
          </div>
        </section>

        <section className="sg-entry-visual" aria-label="SpatialGuard home monitoring overview">
          <header>
            <div><strong>Home overview</strong><span>Replay example</span></div>
            <span className="sg-entry-protected"><Check size={14} />Monitoring on</span>
          </header>

          <div className="sg-entry-map">
            <svg viewBox="0 0 680 430" role="img" aria-label="Floor plan with two cameras and an estimated delivery path">
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
              <g className="sg-entry-room-labels">
                <text x="252" y="145">Study</text>
                <text x="252" y="292">Living room</text>
                <text x="417" y="145">Hallway</text>
                <text x="417" y="292">Kitchen</text>
                <text x="559" y="145">Front entry</text>
              </g>
              <path className="sg-entry-route" d="M610 46 C570 88 542 126 548 168 C554 205 516 232 464 248" />
              <g className="sg-entry-person" transform="translate(474 241)">
                <circle cx="0" cy="0" r="13" />
                <rect x="12" y="-8" width="20" height="18" rx="3" />
              </g>
              <g className="sg-entry-camera" transform="translate(540 77)">
                <circle r="20" />
                <Camera x="-10" y="-10" width="20" height="20" />
              </g>
              <g className="sg-entry-camera" transform="translate(80 338)">
                <circle r="20" />
                <Camera x="-10" y="-10" width="20" height="20" />
              </g>
            </svg>

            <article className="sg-entry-camera-card">
              <span className="sg-entry-camera-thumb"><Camera size={20} /></span>
              <span><strong>Front camera</strong><small>Live available</small></span>
              <span className="sg-entry-live">Live</span>
            </article>

            <article className="sg-entry-incident">
              <span className="sg-entry-incident-icon"><PackageCheck size={22} /></span>
              <span><small>Possible delivery</small><strong>Package placed at front entry</strong></span>
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
