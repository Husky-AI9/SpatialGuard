import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import type { components } from "./generated";
import { native, request, storeToken } from "./platform";
import landingHouse from "./assets/landing-house.png";
import "./landing.css";
import SpatialGuardMark from "./SpatialGuardMark";

type Mode = "signin" | "signup" | "forgot" | "reset" | "verify";
type AuthSession = components["schemas"]["AuthSession"];
export default function AuthPage({ mode }: { mode: Mode }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const signingUp = mode === "signup", recovering = mode === "forgot" || mode === "reset" || mode === "verify";
  const otherHref = native ? `/?auth=${signingUp ? "signin" : "signup"}` : signingUp ? "/signin" : "/signup";
  const workspaceHref = native ? "/?workspace=1" : "/workspace";

  useEffect(() => {
    const title = mode === "verify" ? "Verify email" : mode === "forgot" ? "Reset password" : mode === "reset" ? "Choose password" : signingUp ? "Create account" : "Sign in";
    document.title = `${title} · SpatialGuard`;
  }, [mode, signingUp]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setMessage("");
    if ((signingUp || mode === "reset") && password !== confirmation) { setError("Passwords do not match"); return; }
    setBusy(true);
    try {
      if (mode === "forgot") {
        setMessage((await request<{ message: string }>("/v1/auth/password/request", "POST", { email })).message); return;
      }
      if (mode === "reset") {
        const token = new URLSearchParams(window.location.search).get("token") ?? "";
        setMessage((await request<{ message: string }>("/v1/auth/password/reset", "POST", { token, password })).message); return;
      }
      if (mode === "verify") {
        const token = new URLSearchParams(window.location.search).get("token") ?? "";
        setMessage((await request<{ message: string }>("/v1/auth/email/verify", "POST", { token })).message); return;
      }
      const result = await request<AuthSession>(signingUp ? "/v1/auth/signup" : "/v1/auth/signin", "POST", { email, password });
      if (native) { if (!result.token) throw new Error("The mobile session was not returned"); await storeToken(result.token); }
      window.location.assign(workspaceHref);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Could not continue"); }
    finally { setBusy(false); }
  };

  const title = mode === "verify" ? "Verify your email" : mode === "forgot" ? "Reset your password" : mode === "reset" ? "Choose a new password" : signingUp ? "Create your account" : "Sign in";
  return <main className="sg-auth-page">
    <section className="sg-auth-visual" aria-label="SpatialGuard home and camera coverage illustration">
      <a className="sg-auth-brand" href={native ? "/" : "/landing"}><span><SpatialGuardMark size={20} /></span> SpatialGuard</a>
      <div className="sg-auth-art"><div className="sg-auth-orbit sg-auth-orbit-one" /><div className="sg-auth-orbit sg-auth-orbit-two" /><img src={landingHouse} alt="Illustrative 3D home protected by SpatialGuard" /><div className="sg-auth-signal"><span /> Cameras connected</div><div className="sg-auth-event"><Check size={15} /><span><strong>Evidence connected</strong><small>Front entry to living room</small></span></div></div>
      <div className="sg-auth-visual-copy"><p>One spatial view</p><h1>Every camera makes more sense when you can see where it happened.</h1></div>
    </section>
    <section className="sg-auth-panel" aria-labelledby="sg-auth-title"><div className="sg-auth-form-wrap">
      <a className="sg-auth-back" href={recovering ? "/signin" : native ? "/" : "/landing"}><ArrowLeft size={16} /> {recovering ? "Back to sign in" : "Back to SpatialGuard"}</a>
      <p className="sg-auth-eyebrow">{recovering ? "Account recovery" : signingUp ? "Start your workspace" : "Welcome back"}</p><h2 id="sg-auth-title">{title}</h2>
      {mode !== "signin" && <p className="sg-auth-intro">{mode === "verify" ? "Confirm your email address." : mode === "forgot" ? "We’ll email you a reset link." : mode === "reset" ? "Completing this step signs out every existing device." : "Your cameras, map and incidents in one place."}</p>}
      <form className="sg-auth-form" onSubmit={submit}>
        {mode !== "reset" && mode !== "verify" && <><label htmlFor="auth-email">Email</label><div className="sg-auth-input"><Mail size={17} /><input id="auth-email" type="email" autoComplete="email" autoFocus required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></div></>}
        {mode !== "forgot" && mode !== "verify" && <><label htmlFor="auth-password">{mode === "reset" ? "New password" : "Password"}</label><div className="sg-auth-input"><LockKeyhole size={17} /><input id="auth-password" type={showPassword ? "text" : "password"} autoComplete={signingUp || mode === "reset" ? "new-password" : "current-password"} required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></>}
        {(signingUp || mode === "reset") && <><label htmlFor="auth-confirmation">Confirm password</label><div className="sg-auth-input"><LockKeyhole size={17} /><input id="auth-confirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></div></>}
        {error && <p className="sg-auth-error" role="alert">{error}</p>}{message && <p className="sg-auth-success" role="status">{message} {mode === "reset" && <a href="/signin">Sign in</a>}</p>}
        <button className="sg-auth-submit" disabled={busy || (mode !== "reset" && mode !== "verify" && !email) || (mode !== "forgot" && mode !== "verify" && password.length < 8) || ((signingUp || mode === "reset") && confirmation.length < 8)}>{busy ? "Please waitâ€¦" : mode === "verify" ? "Verify email" : mode === "forgot" ? "Send reset link" : mode === "reset" ? "Change password" : signingUp ? "Create account" : "Sign in"} <ArrowRight size={17} /></button>
      </form>
      {mode === "signin" && <p className="sg-auth-switch"><a href="/forgot-password">Forgot your password?</a></p>}
      {!recovering && <p className="sg-auth-switch">{signingUp ? "Already have an account?" : "New to SpatialGuard?"} <a href={otherHref}>{signingUp ? "Sign in" : "Create an account"}</a></p>}
      <p className="sg-auth-privacy">Ring credentials stay on the server. <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
    </div></section>
  </main>;
}
