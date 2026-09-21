import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
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
  X,
} from "lucide-react";
import "./landing.css";
import { native, localWeb, request } from "./platform";

type AccessDialog = "signin" | "signup" | null;

function SpatialGuardMark({ size = 24 }: { size?: number }) {
  return (
    <svg className="sg-brand-symbol" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2.7 26.2 7v8.1c0 6.6-4 11.6-10.2 14.2C9.8 26.7 5.8 21.7 5.8 15.1V7Z" />
      <path d="M10.4 11.2h11.2v10.1H10.4zm5.6 0v5.2h5.6M10.4 16.4H16" />
      <circle cx="20.8" cy="20.5" r="2.15" />
    </svg>
  );
}

function Brand() {
  return (
    <span className="sg-entry-brand">
      <span className="sg-entry-brand-mark"><SpatialGuardMark size={24} /></span>
      SpatialGuard
    </span>
  );
}

export default function Landing() {
  const [accessDialog, setAccessDialog] = useState<AccessDialog>(null);
  const [accessCode, setAccessCode] = useState("");
  const [accessError, setAccessError] = useState("");
  const [accessBusy, setAccessBusy] = useState(false);
  const workspaceHref = native ? "/?workspace=1" : "/workspace";
  const hostedWeb = !native && !localWeb;
  const previewLabel = hostedWeb ? "Hosted preview: owner access code required" : "Local replay preview: no account required";
  const openWorkspace = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!hostedWeb) return;
    event.preventDefault();
    setAccessError("");
    setAccessDialog("signin");
  };
  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setAccessBusy(true);
    setAccessError("");
    try {
      await request("/v1/hosted-session", "POST", { access_code: accessCode });
      window.location.assign(workspaceHref);
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "Could not sign in");
    } finally {
      setAccessBusy(false);
    }
  };

  useEffect(() => {
    document.title = "SpatialGuard — See what happened and where";
    window.scrollTo({ top: 0, left: 0 });
  }, []);

  useEffect(() => {
    if (!accessDialog) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccessDialog(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [accessDialog]);

  return (
    <div className="sg-entry">
      <section className="sg-mobile-welcome" aria-labelledby="sg-mobile-title">
        <div className="sg-mobile-glow sg-mobile-glow-one" />
        <div className="sg-mobile-glow sg-mobile-glow-two" />

        <header className="sg-mobile-brand">
          <span className="sg-mobile-brand-mark"><SpatialGuardMark size={27} /></span>
          <span>SpatialGuard</span>
        </header>

        <div className="sg-mobile-scene" aria-label="A protected home connected to its cameras">
          <span className="sg-mobile-status"><span /> Monitoring on</span>
          <svg viewBox="0 0 320 230" role="img" aria-label="Detailed protected home with cameras, a delivery path, and a parcel">
            <defs>
              <linearGradient id="sg-house-face" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="1" stopColor="#e8e8f8" />
              </linearGradient>
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

            <g className="sg-mobile-garage">
              <rect x="68" y="120" width="80" height="75" rx="3" />
              <path d="M74 139h68M74 157h68M74 175h68M94 121v74M122 121v74" />
              <circle cx="108" cy="186" r="2" />
            </g>
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
              <circle r="18" />
              <Camera x="-9" y="-9" width="18" height="18" />
            </g>
            <g className="sg-mobile-camera" transform="translate(55 137)">
              <circle r="18" />
              <Camera x="-9" y="-9" width="18" height="18" />
            </g>
            <g className="sg-mobile-parcel" transform="translate(179 164) scale(1.15)">
              <path className="sg-mobile-parcel-top" d="m0 8 14-8 15 8-15 8Z" />
              <path className="sg-mobile-parcel-left" d="M0 8v18l14 8V16Z" />
              <path className="sg-mobile-parcel-right" d="M14 16v18l15-8V8Z" />
              <path className="sg-mobile-parcel-tape" d="m8 3 15 8v7" />
            </g>
          </svg>
          <span className="sg-mobile-event"><PackageCheck size={16} /> Possible delivery</span>
        </div>

        <div className="sg-mobile-sheet">
          <span className="sg-mobile-sheet-icon"><SpatialGuardMark size={26} /></span>
          <p className="sg-mobile-eyebrow">Welcome to SpatialGuard</p>
          <h1 id="sg-mobile-title">See what happened.<br /><span>Know where.</span></h1>
          <p className="sg-mobile-intro">Your cameras, movement, and evidence in one clear home view.</p>
          <div className="sg-mobile-actions">
            <a className="sg-mobile-try" href={workspaceHref} onClick={openWorkspace}><Play size={17} fill="currentColor" />Try it out</a>
            <div>
              <button onClick={() => setAccessDialog("signin")}><LogIn size={16} />Sign in</button>
              <button onClick={() => setAccessDialog("signup")}><UserPlus size={16} />Sign up</button>
            </div>
          </div>
          <small>{previewLabel}</small>
        </div>
      </section>

      <header className="sg-entry-nav">
        <Brand />
        <div className="sg-entry-auth" aria-label="Account access">
          <button onClick={() => setAccessDialog("signin")}><LogIn size={16} />Sign in</button>
          <button className="sg-entry-signup" onClick={() => setAccessDialog("signup")}><UserPlus size={16} />Create account</button>
        </div>
      </header>

      <main className="sg-entry-main">
        <section className="sg-entry-copy" aria-labelledby="sg-entry-title">
          <div className="sg-entry-kicker"><Shield size={17} />Spatial awareness for your cameras</div>
          <h1 id="sg-entry-title">See what happened.<br /><span>Know where.</span></h1>
          <p>SpatialGuard places cameras, movement, and evidence on one home map so you can understand an event without switching between disconnected clips.</p>
          <div className="sg-entry-actions">
            <a className="sg-entry-primary" href={workspaceHref} onClick={openWorkspace}><Play size={17} fill="currentColor" />Try it out</a>
            <button onClick={() => setAccessDialog("signup")}>Create account <ArrowRight size={17} /></button>
          </div>
          <div className="sg-entry-benefits" aria-label="SpatialGuard benefits">
            <span><Map size={17} />2D and 3D home context</span>
            <span><Route size={17} />Retained movement paths</span>
            <span><PackageCheck size={17} />Evidence-led review</span>
          </div>
        </section>

        <section className="sg-entry-visual" aria-label="SpatialGuard home monitoring preview">
          <header>
            <div><strong>Home overview</strong><span>Replay preview</span></div>
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
        <span>{hostedWeb ? "Hosted preview" : "Local replay preview"}</span>
        <span>Built with TwinForge</span>
        <span>Ring connection available in Settings</span>
      </footer>

      {accessDialog && (
        <div className="sg-access-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setAccessDialog(null);
        }}>
          <section className="sg-access-dialog" role="dialog" aria-modal="true" aria-labelledby="sg-access-title">
            <button className="sg-access-close" aria-label="Close" onClick={() => setAccessDialog(null)}><X size={18} /></button>
            {accessDialog === "signin" ? <LogIn size={24} /> : <UserPlus size={24} />}
            <h2 id="sg-access-title">{accessDialog === "signin" ? "Sign in to SpatialGuard" : "Create your SpatialGuard account"}</h2>
            {hostedWeb ? (
              <form className="sg-access-form" onSubmit={signIn}>
                <p>This hosted preview is protected by an owner access code. It creates a secure browser session for this workspace.</p>
                <label htmlFor="landing-access-code">Access code</label>
                <input
                  id="landing-access-code"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  minLength={12}
                  maxLength={128}
                  required
                  value={accessCode}
                  onChange={(event) => setAccessCode(event.target.value)}
                />
                {accessError && <p className="sg-access-error" role="alert">{accessError}</p>}
                <div className="sg-access-actions">
                  <button type="button" onClick={() => setAccessDialog(null)}>Not now</button>
                  <button className="sg-access-submit" disabled={accessBusy || accessCode.length < 12}>
                    {accessBusy ? "Signing in…" : "Open workspace"} <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p>Hosted accounts are not enabled in this local preview yet. Continue to the owner workspace to explore the complete demo without creating credentials.</p>
                <div className="sg-access-actions">
                  <button onClick={() => setAccessDialog(null)}>Not now</button>
                  <a href={workspaceHref}>Continue to workspace <ArrowRight size={16} /></a>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
