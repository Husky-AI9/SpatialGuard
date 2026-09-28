import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import type { components } from "./generated";
import { native, request, storeToken } from "./platform";
import "./landing.css";
import SpatialGuardMark, { PathlightWordmark } from "./SpatialGuardMark";

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
    document.title = `${title} · Pathlight`;
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
  const intro = mode === "verify" ? "Confirm your email address to finish setting up your account."
    : mode === "forgot" ? "Enter your account email and we’ll send you a link to reset your password."
    : mode === "reset" ? "Choose a new password. This signs out every other device."
    : signingUp ? "Start mapping foot traffic with the Ring cameras you already have."
    : "Sign in to see your heatmaps, visits and cameras.";
  const home = native ? "/" : "/landing";
  return <main className="pl-auth">
    <header className="pl-auth-top">
      <a className="pl-auth-logo" href={home} aria-label="Pathlight home"><SpatialGuardMark size={26} /><PathlightWordmark /></a>
      <a className="pl-auth-back" href={recovering ? "/signin" : home}><ArrowLeft size={16} aria-hidden="true" />{recovering ? "Back to sign in" : "Back to Pathlight"}</a>
    </header>

    <section className="pl-auth-card" aria-labelledby="sg-auth-title">
      <h1 id="sg-auth-title">{title}</h1>
      <p className="pl-auth-intro">{intro}</p>
      <form className="sg-auth-form" onSubmit={submit} noValidate={false}>
        {mode !== "reset" && mode !== "verify" && <>
          <label htmlFor="auth-email">Email</label>
          <div className="sg-auth-input"><Mail size={17} aria-hidden="true" /><input id="auth-email" type="email" autoComplete="email" autoFocus required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" /></div>
        </>}
        {mode !== "forgot" && mode !== "verify" && <>
          <div className="pl-auth-label-row">
            <label htmlFor="auth-password">{mode === "reset" ? "New password" : "Password"}</label>
            {mode === "signin" && <a href="/forgot-password">Forgot your password?</a>}
          </div>
          <div className="sg-auth-input"><LockKeyhole size={17} aria-hidden="true" /><input id="auth-password" type={showPassword ? "text" : "password"} autoComplete={signingUp || mode === "reset" ? "new-password" : "current-password"} required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder={signingUp || mode === "reset" ? "At least 8 characters" : "Your password"} /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
        </>}
        {(signingUp || mode === "reset") && <>
          <label htmlFor="auth-confirmation">Confirm password</label>
          <div className="sg-auth-input"><LockKeyhole size={17} aria-hidden="true" /><input id="auth-confirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></div>
        </>}
        {error && <p className="sg-auth-error" role="alert">{error}</p>}
        {message && <p className="sg-auth-success" role="status">{message} {mode === "reset" && <a href="/signin">Sign in</a>}</p>}
        <button className="sg-auth-submit" disabled={busy || (mode !== "reset" && mode !== "verify" && !email) || (mode !== "forgot" && mode !== "verify" && password.length < 8) || ((signingUp || mode === "reset") && confirmation.length < 8)}>{busy ? "Please wait…" : mode === "verify" ? "Verify email" : mode === "forgot" ? "Send reset link" : mode === "reset" ? "Change password" : signingUp ? "Create account" : "Sign in"}</button>
      </form>
      {signingUp && <p className="pl-auth-legal">By creating an account you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy policy</a>.</p>}
    </section>

    {!recovering && <p className="pl-auth-switch">{signingUp ? "Already have an account?" : "New to Pathlight?"} <a href={otherHref}>{signingUp ? "Sign in" : "Create an account"}</a></p>}

    <footer className="pl-auth-footer">
      <span>© 2026 Pathlight</span>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <span className="pl-auth-secure"><ShieldCheck size={14} aria-hidden="true" />Ring credentials stay on the server</span>
    </footer>
  </main>;
}
