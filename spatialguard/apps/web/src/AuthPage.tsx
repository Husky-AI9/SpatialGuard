import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail, Shield } from "lucide-react";
import type { components } from "./generated";
import { native, request, storeToken } from "./platform";
import landingHouse from "./assets/landing-house.png";
import "./landing.css";

type Mode = "signin" | "signup";
type AuthSession = components["schemas"]["AuthSession"];

const testEmail = "test12345@gmail.com";
const testPassword = "test12345";

export default function AuthPage({ mode }: { mode: Mode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signingUp = mode === "signup";
  const otherHref = native
    ? `/?auth=${signingUp ? "signin" : "signup"}`
    : signingUp ? "/signin" : "/signup";
  const workspaceHref = native ? "/?workspace=1" : "/workspace";

  useEffect(() => {
    document.title = `${signingUp ? "Create account" : "Sign in"} · SpatialGuard`;
  }, [signingUp]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (signingUp && password !== confirmation) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const result = await request<AuthSession>(
        signingUp ? "/v1/auth/signup" : "/v1/auth/signin",
        "POST",
        { email, password },
      );
      if (native) {
        if (!result.token) throw new Error("The Android session was not returned");
        await storeToken(result.token);
      }
      window.location.assign(workspaceHref);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not continue");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="sg-auth-page">
      <section className="sg-auth-visual" aria-label="SpatialGuard home and camera coverage illustration">
        <a className="sg-auth-brand" href={native ? "/" : "/landing"}>
          <span><Shield size={20} /></span> SpatialGuard
        </a>
        <div className="sg-auth-art">
          <div className="sg-auth-orbit sg-auth-orbit-one" />
          <div className="sg-auth-orbit sg-auth-orbit-two" />
          <img src={landingHouse} alt="Illustrative 3D home protected by SpatialGuard" />
          <div className="sg-auth-signal"><span /> Cameras connected</div>
          <div className="sg-auth-event"><Check size={15} /><span><strong>Movement connected</strong><small>Front entry to living room</small></span></div>
        </div>
        <div className="sg-auth-visual-copy">
          <p>One spatial view</p>
          <h1>Every camera makes more sense when you can see where it happened.</h1>
        </div>
      </section>

      <section className="sg-auth-panel" aria-labelledby="sg-auth-title">
        <div className="sg-auth-form-wrap">
          <a className="sg-auth-back" href={native ? "/" : "/landing"}><ArrowLeft size={16} /> Back to SpatialGuard</a>
          <p className="sg-auth-eyebrow">{signingUp ? "Start your workspace" : "Welcome back"}</p>
          <h2 id="sg-auth-title">{signingUp ? "Create your account" : "Sign in"}</h2>
          <p className="sg-auth-intro">
            {signingUp
              ? "Use your email to create a private workspace for your maps, incidents, and Ring connection."
              : "Open your SpatialGuard workspace with your email and password."}
          </p>

          <form className="sg-auth-form" onSubmit={submit}>
            <label htmlFor="auth-email">Email</label>
            <div className="sg-auth-input">
              <Mail size={17} />
              <input
                id="auth-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <label htmlFor="auth-password">Password</label>
            <div className="sg-auth-input">
              <LockKeyhole size={17} />
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                autoComplete={signingUp ? "new-password" : "current-password"}
                required
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
              />
              <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {signingUp && (
              <>
                <label htmlFor="auth-confirmation">Confirm password</label>
                <div className="sg-auth-input">
                  <LockKeyhole size={17} />
                  <input
                    id="auth-confirmation"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={128}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </div>
              </>
            )}
            {error && <p className="sg-auth-error" role="alert">{error}</p>}
            <button className="sg-auth-submit" disabled={busy || !email || password.length < 8 || (signingUp && confirmation.length < 8)}>
              {busy ? "Please wait…" : signingUp ? "Create account" : "Sign in"} <ArrowRight size={17} />
            </button>
          </form>

          {!signingUp && (
            <div className="sg-auth-test">
              <span>Test workspace</span>
              <code>{testEmail}</code>
              <button type="button" onClick={() => { setEmail(testEmail); setPassword(testPassword); setError(""); }}>
                Use test account
              </button>
            </div>
          )}

          <p className="sg-auth-switch">
            {signingUp ? "Already have an account?" : "New to SpatialGuard?"} <a href={otherHref}>{signingUp ? "Sign in" : "Create an account"}</a>
          </p>
          <p className="sg-auth-privacy">Passwords are stored as salted verifiers. Your Ring credentials stay on the server and are never sent to this page.</p>
        </div>
      </section>
    </main>
  );
}
