import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import "./desktop-landing.css";

type Props = {
  hostedWeb: boolean;
  openSignIn: () => void;
  openSignUp: () => void;
  openWorkspace: (event: MouseEvent<HTMLAnchorElement>) => void;
  workspaceHref: string;
};

// Illustrative fixture from LandingPageConcept, never real camera evidence.
const moments = [
      { n: 1, time: '2:02:08 PM', cam: 'Parking', title: 'A visitor parks and walks over', body: 'The parking camera picks them up and opens visit 0417.', x: 460, y: 560, trail: '460,592 460,560', cams: [1] },
      { n: 2, time: '2:02:15 PM', cam: 'Sidewalk', title: 'Passes the storefront', body: 'The sidewalk camera takes over. Same visitor, same ID, never counted twice.', x: 360, y: 511, trail: '460,592 460,548 360,511', cams: [2] },
      { n: 3, time: '2:02:31 PM', cam: 'Entrance', title: 'Walks in', body: 'The entrance camera logs a walk-in and adds a point to today\u2019s heatmap.', x: 300, y: 396, trail: '460,592 460,548 330,500 300,460 300,396', cams: [3] },
      { n: 4, time: '2:02:44 PM', cam: 'Parking', title: 'Heads back to the car', body: 'Visit 0417 closes. One path, three cameras, one visitor in your counts.', x: 470, y: 590, trail: '460,592 460,548 330,500 300,460 300,396 300,460 330,500 460,548 470,590', cams: [1] }
    ];

export default function DesktopLanding({hostedWeb, openSignIn, openSignUp, openWorkspace, workspaceHref}: Props) {
  const [step, setStep] = useState(1);
  const [mapMode, setMapMode] = useState("2D");
  const [paused, setPaused] = useState(false);
  const [info, setInfo] = useState<"faq" | "contact" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const accent = "#5B4FE8", courier = "#E8752A";
  const current = moments.find(moment => moment.n === step)!;
  const pos = current, trail = current.trail;
  const steps = moments.map(moment => ({...moment,
    bg: moment.n === step ? "#FFFFFF" : "transparent",
    border: moment.n === step ? accent : "#D3D4E8",
    dotBg: moment.n === step ? accent : "transparent",
    dotBorder: moment.n === step ? accent : "#C4C5DF",
    dotText: moment.n === step ? "#FFFFFF" : "#23253F",
    pick: () => setStep(moment.n),
  }));
  const tiles = ["Parking", "Sidewalk", "Entrance"].map((name, index) => {
    const active = current.cams.includes(index + 1);
    return {name, border: active ? accent : "#D3D4E8", status: active ? "Tracking" : "Clear",
      statusColor: active ? "#4C42C8" : "#6A6C88", personOpacity: active ? 1 : 0};
  });
  const [cone1, cone2, cone3] = [1, 2, 3].map(camera => current.cams.includes(camera) ? .24 : .05);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPaused(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    root.current?.querySelectorAll<SVGSVGElement>("svg").forEach(svg => {
      if (paused) svg.pauseAnimations(); else svg.unpauseAnimations();
    });
  }, [paused]);
  useEffect(() => { if (info) dialog.current?.showModal(); }, [info]);
  return <div className="sg-concept lp-desktop" ref={root} data-map-mode={mapMode}>
<main className="concept-page">


<section className="concept-hero" id="top">

<nav className="concept-nav" aria-label="Landing page">
<a className="concept-brand" href="#top">
<span className="concept-brand-mark"><svg width="20" height="20" viewBox="0 0 32 32" fill="none" stroke="#23253F" strokeLinecap="round"><path d="M5.5 26.5c6 0 6.4-7.4 10.8-7.4s4.6-6.3 8.9-8" strokeWidth="2.6"></path><path d="M25.6 2.9v1.8M31.4 8.6h-1.8M29.7 4.6l-1.3 1.3" strokeWidth="1.9"></path><circle cx="25.6" cy="10.2" r="3.2" fill="#d49431" strokeWidth="1.2"></circle><circle cx="5.5" cy="26.5" r="1.7" fill="#23253F" stroke="none"></circle></svg></span>
<span >Pathlight<sup className="concept-brand-dot">●</sup></span>
</a>
<div className="concept-nav-links">
<a className="concept-nav-home" href="#top">Home</a>
<a className="concept-nav-link" href="#how">How it works</a>
<a className="concept-nav-link" href="#delivery">A visit</a>
<a className="concept-nav-link" href="#uses">Use cases</a>
<a className="concept-nav-link" href="#faq" onClick={(event) => { event.preventDefault(); setInfo("faq"); }}>FAQ</a>
</div>
<a className="concept-sign-in" href="/signin" onClick={(event) => { event.preventDefault(); openSignIn(); }}>Sign in</a>
</nav>

<div className="concept-hero-grid">


<div className="concept-intro">
<div className="concept-section-label"><span className="concept-label-rule"></span>Foot-traffic analytics for Ring cameras</div>
<h1 className="concept-title">See where people go. <span className="concept-accent-text">Know what works.</span></h1>
<p className="concept-lead">Turn the Ring cameras you already have into a live map of how customers move through your space.</p>
<p className="concept-description">Pathlight puts people heatmaps, visitor paths and busy hours on your own 2D or 3D floor plan, so layout, staffing and displays follow real traffic.</p>
<div className="concept-intro-actions">
<a className="concept-try-link" href={workspaceHref} onClick={openWorkspace}>
<span className="concept-play-symbol"><svg width="14" height="16" viewBox="0 0 14 16"><path d="M2 1.5v13l11-6.5z" fill="#FFFFFF"></path></svg></span>
Try Pathlight</a>
<a className="concept-replay-link" href="#delivery">Follow a visit <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#23253F" strokeWidth="1.6" strokeLinecap="round"><path d="M2 7h10M8 3l4 4-4 4"></path></svg></a>
</div>
<div className="concept-access-note">{hostedWeb ? "Private workspace, email sign-in required" : "Local replay: no account required"}</div>
<div className="concept-stats">
<div className="concept-stat-card">
<div className="concept-stat-heading"><span className="concept-stat-value">3</span><span className="concept-stat-unit">cameras</span></div>
<p className="concept-stat-description">One visitor, one ID the whole way. Counted once, not three times.</p>
</div>
<div className="concept-stat-highlight">
<div className="concept-stat-heading"><span className="concept-stat-highlight-value">36s</span><span className="concept-stat-unit">curb to door</span></div>
<p className="concept-stat-highlight-description">From the parking spot to your entrance, logged as a single visit.</p>
</div>
</div>
</div>


<div className="concept-hero-map">
<svg className="concept-hero-svg" viewBox="0 0 600 600" width="600" height="600" aria-label="Bird's-eye store map with a foot-traffic heatmap: a visitor walks from parking to the entrance while three cameras hand off tracking" role="img">
<defs >
<pattern id="gridA" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#D7D8EC" strokeWidth="1"></path></pattern>
<radialGradient id="heatA"><stop offset="0%" stopColor="#E5322D" stopOpacity="0.85"></stop><stop offset="35%" stopColor="#FF8A1F" stopOpacity="0.62"></stop><stop offset="62%" stopColor="#FFD640" stopOpacity="0.38"></stop><stop offset="100%" stopColor="#42AAFF" stopOpacity="0"></stop></radialGradient>
<radialGradient id="fadeA" cx="50%" cy="50%" r="55%"><stop offset="62%" stopColor="#E9EAF6" stopOpacity="0"></stop><stop offset="100%" stopColor="#E9EAF6" stopOpacity="1"></stop></radialGradient>
</defs>
<rect x="0" y="0" width="600" height="600" fill="url(#gridA)"></rect>
<rect x="0" y="560" width="600" height="40" fill="#D9DAEB"></rect>
<path d="M0 580H600" stroke="#FFFFFF" strokeWidth="2" strokeDasharray="14 12"></path>
<rect x="40" y="30" width="520" height="522" rx="4" fill="none" stroke="#A3A5C8" strokeWidth="1.5" strokeDasharray="6 6"></rect>
<rect x="150" y="110" width="300" height="230" rx="3" fill="#FFFFFF" stroke="#8E91B8" strokeWidth="2"></rect>
<path d="M150 222H300M300 110V340M300 250H450M220 222V340" stroke="#D2D3E6" strokeWidth="1.5"></path>
<rect x="255" y="340" width="90" height="44" fill="#F3F3FB" stroke="#8E91B8" strokeWidth="1.5"></rect>
<rect x="420" y="372" width="90" height="188" fill="#E2E3F1" stroke="#C4C5DF" strokeWidth="1.5"></rect>
<path d="M300 384V460L330 500L420 532" fill="none" stroke="#DEDFEF" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round"></path>
<g fontFamily="Source Sans 3, sans-serif" fontSize="12" fill="#6A6C88">
<text x="300" y="72" textAnchor="middle">Loading area</text>
<text x="225" y="170" textAnchor="middle">Sales floor</text>
<text x="375" y="185" textAnchor="middle">Café</text>
<text x="300" y="366" textAnchor="middle">Entrance</text>
<text x="465" y="470" textAnchor="middle" transform="rotate(-90 465 470)">Parking</text>
<text x="130" y="590">Street</text>
</g>
<rect x="486" y="565" width="78" height="30" rx="6" fill="#C7C9E0" stroke="#A3A5C8"></rect>
<text x="525" y="584" textAnchor="middle" fill="#3A3D5C" fontSize="11" fontFamily="Source Sans 3, sans-serif">Car</text>
<g className="concept-heat" pointerEvents="none">
<circle cx="300" cy="300" r="62" fill="url(#heatA)"><animate attributeName="opacity" dur="6s" repeatCount="indefinite" values="0.9;1;0.9"></animate></circle>
<circle cx="214" cy="280" r="44" fill="url(#heatA)" opacity="0.8"></circle>
<circle cx="238" cy="160" r="50" fill="url(#heatA)" opacity="0.7"><animate attributeName="opacity" dur="7s" repeatCount="indefinite" values="0.55;0.8;0.55"></animate></circle>
<circle cx="392" cy="208" r="40" fill="url(#heatA)" opacity="0.6"></circle>
<circle cx="360" cy="296" r="30" fill="url(#heatA)" opacity="0.45"></circle>
</g>

<path d="M505 378L420 600L580 600Z" fill={accent} opacity="0.05"><animate attributeName="opacity" dur="12s" repeatCount="indefinite" values="0.24;0.24;0.05;0.05;0.24;0.24" keyTimes="0;0.08;0.11;0.8;0.83;1"></animate></path>
<path d="M160 345L330 610L520 500Z" fill={accent} opacity="0.05"><animate attributeName="opacity" dur="12s" repeatCount="indefinite" values="0.05;0.05;0.24;0.24;0.05;0.05;0.24;0.24;0.05;0.05" keyTimes="0;0.05;0.08;0.29;0.32;0.57;0.6;0.83;0.86;1"></animate></path>
<path d="M300 386L236 492L364 492Z" fill={accent} opacity="0.05"><animate attributeName="opacity" dur="12s" repeatCount="indefinite" values="0.05;0.05;0.28;0.28;0.05;0.05" keyTimes="0;0.21;0.24;0.61;0.64;1"></animate></path>
<path d="M452 110L200 40L452 40Z" fill={accent} opacity="0.07"></path>

<g fontFamily="Source Sans 3, sans-serif" fontSize="12" fontWeight="600" fill="#23253F">
<circle cx="505" cy="378" r="8" fill="#FFFFFF" stroke={accent} strokeWidth="2.5"></circle><circle cx="505" cy="378" r="3" fill={accent}></circle><text x="519" y="372">Cam 1</text>
<circle cx="160" cy="345" r="8" fill="#FFFFFF" stroke={accent} strokeWidth="2.5"></circle><circle cx="160" cy="345" r="3" fill={accent}></circle><text x="96" y="349">Cam 2</text>
<circle cx="300" cy="386" r="8" fill="#FFFFFF" stroke={accent} strokeWidth="2.5"></circle><circle cx="300" cy="386" r="3" fill={accent}></circle><text x="232" y="404">Cam 3</text>
<circle cx="452" cy="110" r="8" fill="#FFFFFF" stroke={accent} strokeWidth="2.5"></circle><circle cx="452" cy="110" r="3" fill={accent}></circle><text x="466" y="106">Cam 4</text>
</g>

<path d="M460 592L460 548L330 500L300 460L300 394" fill="none" stroke={courier} strokeWidth="2" strokeDasharray="3 6" opacity="0.7"></path>
<g >
<circle r="16" fill={courier} opacity="0.2"><animate attributeName="r" dur="1.6s" repeatCount="indefinite" values="10;20;10"></animate></circle>
<circle r="7" fill={courier} stroke="#FFFFFF" strokeWidth="2.5"></circle>
<rect x="12" y="-32" width="96" height="22" rx="11" fill="#23253F"></rect>
<text x="60" y="-17" textAnchor="middle" fill="#FFFFFF" fontSize="12" fontWeight="600" fontFamily="Source Sans 3, sans-serif">Visitor 0417</text>
<animateMotion dur="12s" repeatCount="indefinite" calcMode="linear" keyPoints="0;0.5;0.5;1;1" keyTimes="0;0.36;0.52;0.9;1" path="M460 592L460 548L330 500L300 460L300 394L300 460L330 500L460 548L460 592"></animateMotion>
</g>
<rect x="0" y="0" width="600" height="600" fill="url(#fadeA)" pointerEvents="none"></rect>
</svg>

<div className="concept-demo-badge">
<span className="concept-demo-dot"></span>4 cameras · live heatmap · illustrative
</div>
<div className="concept-handoff-label">
Tracking handoff<br  />
<span className="concept-handoff-cameras">Cam 1 to Cam 2 to Cam 3</span>
</div>
<div className="concept-map-modes">
<button className="concept-map-mode-2d" aria-label="Switch to 2D map" type="button" aria-pressed={mapMode === "2D"} onClick={() => setMapMode("2D")}>2D</button>
<button className="concept-map-mode-3d" aria-label="Switch to 3D map" type="button" aria-pressed={mapMode === "3D"} onClick={() => setMapMode("3D")}>3D</button>
</div>
</div>


<div className="concept-evidence">
<p className="concept-evidence-description">Your cameras already see every visitor. Pathlight turns them into traffic you can act on.</p>
<div className="concept-evidence-card">
<div className="concept-evidence-image">
<svg className="concept-svg" viewBox="0 0 290 150" width="100%" height="150" preserveAspectRatio="xMidYMid slice">
<rect width="290" height="150" fill="#2B2D4A"></rect>
<path d="M0 118H290" stroke="#3E4166"></path>
<rect x="95" y="0" width="100" height="44" fill="#34375A" stroke="#474A72"></rect>
<path d="M130 44V150M160 44V150" stroke="#34375A" strokeWidth="18"></path>
<ellipse cx="148" cy="82" rx="14" ry="9" fill="#5C6090"></ellipse>
<circle cx="148" cy="80" r="6.5" fill="#8A8EBC"></circle>
<rect x="126" y="62" width="44" height="38" fill="none" stroke={courier} strokeWidth="2" rx="3"></rect>
<rect x="126" y="48" width="38" height="14" fill={courier} rx="2"></rect>
<text x="145" y="58.5" textAnchor="middle" fill="#2B1300" fontSize="9" fontWeight="700" fontFamily="Source Sans 3, sans-serif">0417</text>
</svg>
<span className="concept-camera-caption">Cam 3, Entrance</span>
</div>
<div className="concept-evidence-caption">
<span className="concept-semibold">Walk-in counted</span>
<span className="concept-muted">2:02:31 PM</span>
</div>
</div>
<div className="concept-visit-card">
<div className="concept-visit-count">1 visitor</div>
<div className="concept-visit-description">counted once across 3 cameras</div>
</div>
<p className="concept-integration-note">Works with the cameras you already have. Ring cameras and doorbells.</p>
</div>
</div>

<p className="concept-statement">Stop guessing how your space is used. See <span className="concept-accent-text">where people walk, where they stop</span> and when you’re busiest, all on one map.</p>
</section>


<section className="concept-replay" id="delivery">
<div className="concept-section-heading">
<div className="concept-section-heading-copy">
<div className="concept-section-label"><span className="concept-label-rule"></span>One visit</div>
<h2 className="concept-replay-title">Follow one visitor, start to finish</h2>
</div>
<p className="concept-replay-description">Pick a moment. The map shows where the visitor was and which camera had them. However many cameras see them, they count once.</p>
</div>

<div className="concept-replay-grid">
<div className="concept-replay-map">
<svg className="concept-svg" viewBox="0 0 600 600" width="600" height="600" aria-label="Replay map for the selected moment" role="img">
<defs ><pattern id="gridB" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#E6E7F3" strokeWidth="1"></path></pattern></defs>
<rect width="600" height="600" rx="16" fill="#F7F7FC"></rect>
<rect width="600" height="600" rx="16" fill="url(#gridB)"></rect>
<rect x="0" y="560" width="600" height="40" fill="#E0E1EF"></rect>
<path d="M0 580H600" stroke="#FFFFFF" strokeWidth="2" strokeDasharray="14 12"></path>
<rect x="40" y="30" width="520" height="522" rx="4" fill="none" stroke="#A3A5C8" strokeWidth="1.5" strokeDasharray="6 6"></rect>
<rect x="150" y="110" width="300" height="230" rx="3" fill="#FFFFFF" stroke="#8E91B8" strokeWidth="2"></rect>
<path d="M150 222H300M300 110V340M300 250H450M220 222V340" stroke="#D2D3E6" strokeWidth="1.5"></path>
<rect x="255" y="340" width="90" height="44" fill="#F3F3FB" stroke="#8E91B8" strokeWidth="1.5"></rect>
<rect x="420" y="372" width="90" height="188" fill="#E8E9F4" stroke="#C4C5DF" strokeWidth="1.5"></rect>
<path d="M300 384V460L330 500L420 532" fill="none" stroke="#E4E5F2" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round"></path>
<rect x="486" y="565" width="78" height="30" rx="6" fill="#C7C9E0" stroke="#A3A5C8"></rect>
<path d="M505 378L420 600L580 600Z" fill={accent} opacity={cone1}></path>
<path d="M160 345L330 610L520 500Z" fill={accent} opacity={cone2}></path>
<path d="M300 386L236 492L364 492Z" fill={accent} opacity={cone3}></path>
<g fontFamily="Source Sans 3, sans-serif" fontSize="13" fontWeight="600" fill="#23253F">
<circle cx="505" cy="378" r="8" fill="#FFFFFF" stroke={accent} strokeWidth="2.5"></circle><text x="519" y="372">Parking</text>
<circle cx="160" cy="345" r="8" fill="#FFFFFF" stroke={accent} strokeWidth="2.5"></circle><text x="84" y="349">Sidewalk</text>
<circle cx="300" cy="386" r="8" fill="#FFFFFF" stroke={accent} strokeWidth="2.5"></circle><text x="226" y="406">Entrance</text>
</g>
<polyline points={trail} fill="none" stroke={courier} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"></polyline>
<circle cx={pos.x} cy={pos.y} r="18" fill={courier} opacity="0.22"></circle>
<circle cx={pos.x} cy={pos.y} r="7.5" fill={courier} stroke="#FFFFFF" strokeWidth="2.5"></circle>
</svg>
<div className="concept-track-caption">Visit 0417, {current.time}</div>
</div>

<div className="concept-timeline">
{steps.map(s => (<button className="concept-moment" style={{"--s-border": s.border, "--s-bg": s.bg} as CSSProperties} onClick={s.pick} key={s.n} aria-pressed={s.n === step}>
<span className="concept-moment-number" style={{"--s-dotBorder": s.dotBorder, "--s-dotBg": s.dotBg, "--s-dotText": s.dotText} as CSSProperties}>{s.n}</span>
<span className="concept-moment-copy">
<span className="concept-moment-title">{s.title}</span>
<span className="concept-moment-description">{s.body}</span>
</span>
<span className="concept-moment-meta">
<span >{s.time}</span>
<span className="concept-moment-camera">{s.cam}</span>
</span>
</button>))}

<div className="concept-camera-tiles">
{tiles.map(t => (<div className="concept-camera-tile" style={{"--t-border": t.border} as CSSProperties} key={t.name}>
<svg className="concept-svg" viewBox="0 0 200 110" width="100%">
<rect width="200" height="110" fill="#2B2D4A"></rect>
<path d="M0 90H200" stroke="#3E4166"></path>
<path d="M60 0V110M140 0V110" stroke="#34375A" strokeWidth="10"></path>
<g opacity={t.personOpacity}>
<ellipse cx="100" cy="58" rx="13" ry="8" fill="#5C6090"></ellipse>
<circle cx="100" cy="56" r="6" fill="#8A8EBC"></circle>
<rect x="80" y="38" width="40" height="36" rx="3" fill="none" stroke={courier} strokeWidth="2"></rect>
<rect x="80" y="25" width="34" height="13" rx="2" fill={courier}></rect>
<text x="97" y="35" textAnchor="middle" fill="#2B1300" fontSize="9" fontWeight="700" fontFamily="Source Sans 3, sans-serif">0417</text>
</g>
</svg>
<div className="concept-tile-caption">
<span className="concept-semibold">{t.name}</span>
<span className="concept-tile-status" style={{"--t-statusColor": t.statusColor} as CSSProperties}>{t.status}</span>
</div>
</div>))}
</div>
</div>
</div>
</section>


<section className="concept-how" id="how">
<h2 className="concept-how-title">From camera feeds to a live traffic map</h2>
<div className="concept-how-grid">
<div className="concept-how-step">
<span className="concept-how-number">1</span>
<h3 className="concept-how-step-title">Map your space</h3>
<p className="concept-how-description">Upload your store or office floor plan, then drop each Ring camera where it hangs and aim its view.</p>
</div>
<div className="concept-how-step">
<span className="concept-how-number">2</span>
<h3 className="concept-how-step-title">Pathlight follows people across cameras</h3>
<p className="concept-how-description">It knows where views meet, so a visitor leaving the parking camera is expected at the entrance next, and counted once.</p>
</div>
<div className="concept-how-step-last">
<span className="concept-how-number">3</span>
<h3 className="concept-how-step-title">See traffic, not clips</h3>
<p className="concept-how-description">Every visit becomes a path and a point on the heatmap. Spot busy hours, dead zones and queues at a glance.</p>
</div>
</div>
</section>


<section className="concept-uses" id="uses">
<div className="concept-use-grid">
<div className="concept-use-card">
<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke={courier} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"><path d="M9 14h22l-2 20H11z"></path><path d="M15 14v-3a5 5 0 0 1 10 0v3"></path></svg>
<h3 className="concept-use-title">Retail and cafés</h3>
<p className="concept-use-description">See which displays draw people and which corners sit empty, then rearrange with evidence, not hunches.</p>
</div>
<div className="concept-use-card">
<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round"><circle cx="14" cy="14" r="5"></circle><circle cx="28" cy="16" r="4"></circle><path d="M5 32c1-6 5-9 9-9s8 3 9 9M22 31c1-4 3-7 6-7s5 3 6 7"></path></svg>
<h3 className="concept-use-title">Offices and clinics</h3>
<p className="concept-use-description">Measure lobby and waiting-room traffic and peak hours, so the front desk is staffed when it matters.</p>
</div>
<div className="concept-use-card">
<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="#23253F" strokeWidth="2" strokeLinecap="round"><path d="M28 24A12 12 0 1 1 16 8a9 9 0 0 0 12 16z"></path><path d="M30 8v6M27 11h6"></path></svg>
<h3 className="concept-use-title">After-hours alerts</h3>
<p className="concept-use-description">The same cameras watch the premises when you’re closed, and alert you when someone heads for the stockroom.</p>
</div>
</div>
</section>


<section className="concept-start" id="start">
<div className="concept-cta-copy">
<h2 className="concept-cta-title">Map your foot traffic</h2>
<p className="concept-cta-description">Upload a floor plan, place your Ring cameras, and watch your first heatmap fill in.</p>
</div>
<div className="concept-cta-actions">
<a className="concept-cta-primary" href={workspaceHref} onClick={openWorkspace}>Try Pathlight</a>
<a className="concept-cta-secondary" href="#delivery">Follow a visit</a>
</div>
</section>

<footer className="concept-footer" id="faq">
<span >© 2026 Pathlight</span>
<div className="concept-footer-links">
<a href="#faq" onClick={(event) => { event.preventDefault(); setInfo("faq"); }}>FAQ</a>
<a href="/privacy">Privacy</a>
<a href="/terms">Terms</a>
<a href="#contact" onClick={(event) => { event.preventDefault(); setInfo("contact"); }}>Contact</a>
</div>
</footer>

</main>
    <div className="concept-demo-controls">
      <span>Illustrative visit and heatmap · estimated paths; camera handoffs are possible continuations, not verified identity.</span>
      <button type="button" onClick={() => setPaused(value => !value)}>{paused ? "Play animation" : "Pause animation"}</button>
    </div>
    <dialog className="concept-dialog" ref={dialog} onClose={() => setInfo(null)} aria-labelledby="concept-info-title">
      <h2 id="concept-info-title">{info === "faq" ? "Frequently asked questions" : "Contact Pathlight"}</h2>
      {info === "faq" ? <>
        <h3>Is this a live camera feed?</h3><p>This page uses an illustrative store visit. Your authorized Ring cameras, heatmaps and events are in your private workspace.</p>
        <h3>How accurate are the paths and heatmaps?</h3><p>Positions are estimates from each camera's view, not calibrated measurements. Links between cameras are possible continuations, not verified identity.</p>
        <h3>Does Pathlight identify people?</h3><p>No. It counts visits and draws paths. It does not recognize faces or identify anyone.</p>
        <h3>How do I get started?</h3><p>Create an account, connect Ring, and pair your cameras with your floor plan.</p>
        <button type="button" onClick={openSignUp}>Create account</button>
      </> : <p>Pathlight is currently a private preview. For support, contact the person who invited you. Include your device, the affected camera, and the time of the issue. Never send passwords or camera credentials.</p>}
      <form method="dialog"><button type="submit">Close</button></form>
    </dialog>
  </div>;
}
