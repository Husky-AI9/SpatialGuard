import { ArrowLeft } from "lucide-react";
import SpatialGuardMark from "./SpatialGuardMark";
import type { ReactNode } from "react";
import { native } from "./platform";

type LegalKind = "privacy" | "terms" | "data-deletion";

const content: Record<LegalKind, { title: string; intro: string; sections: { title: string; body: ReactNode }[] }> = {
  privacy: {
    title: "Privacy notice",
    intro: "This notice describes Pathlight and the controls available inside the product.",
    sections: [
      { title: "Data the service keeps", body: <p>Pathlight stores your account email and salted password verifier, home maps and uploaded floor-plan data, camera mappings, signed event metadata, incident reviews, security audit records, and your saved settings. If you create a time-lapse, its still images are stored until the project or account is deleted.</p> },
      { title: "Ring data", body: <p>Ring access is optional. After you authorize the private Ring app, server-held credentials are encrypted at rest. Inventory, device status, event metadata, snapshots, and bounded live-view sessions are used only for enabled features. Pathlight does not record live video. A snapshot used for classification is not retained by Pathlight.</p> },
      { title: "Optional classification", body: <p>If you separately allow snapshot classification, up to three authorized event snapshots may be sent to the configured OpenAI model. The saved result is a cautious category for review. Pathlight does not perform face identification or infer gender.</p> },
      { title: "Retention and deletion", body: <p>Visit retention defaults to 90 days and audit retention to 365 days. You can choose the available periods in Settings. Account deletion removes owner-scoped maps, floor plans, incidents, sessions, Ring records, and time-lapse files after disconnecting the provider integration.</p> },
      { title: "Service providers", body: <p>The service runs on Railway infrastructure. Ring processes authorized camera data under your Ring account. OpenAI receives a snapshot only when the separate classification permission and feature are enabled.</p> },
    ],
  },
  terms: {
    title: "Terms of service",
    intro: "Pathlight is an evaluation build for reviewing camera events in spatial context.",
    sections: [
      { title: "Authorized use", body: <p>Use Pathlight only with cameras, accounts, and floor plans you own or have permission to access. Keep your account password private and revoke sessions you no longer recognize.</p> },
      { title: "Evidence boundaries", body: <p>Camera observations, possible continuations, unknown gaps, replay fixtures, and estimated test-video positions are different evidence types. Classification labels can be wrong and always require human review. The service does not establish identity or an exact person location without calibrated evidence.</p> },
      { title: "No emergency service", body: <p>Pathlight is a convenience and review tool. It is not a security, emergency, medical, or life-safety service and should not be used as the only basis for an emergency decision.</p> },
      { title: "Service availability", body: <p>Features may change or be unavailable during maintenance. Ring integration depends on the owner’s authorization, applicable subscription state, and provider availability.</p> },
    ],
  },
  "data-deletion": {
    title: "Delete your data",
    intro: "You can remove individual places or permanently delete the entire Pathlight account.",
    sections: [
      { title: "Delete a place", body: <p>Open Settings → Places and choose Remove. This deletes that map, uploaded drawing, camera placement, incidents, evidence, and replay history from Pathlight and TwinForge.</p> },
      { title: "Delete the account", body: <p>Open Settings → Delete account. Enter your current password and type DELETE. Pathlight first disconnects the Ring integration, then removes the account and its owner-scoped data. If Ring is unavailable, the account stays intact so you can retry or remove Pathlight from Ring first.</p> },
      { title: "Revoke a device", body: <p>Open Settings → Connected sessions to revoke a browser or Android session without deleting other data. You can also disconnect Ring separately from the Ring connection section.</p> },
      { title: "Retention", body: <p>Settings → Privacy and retention lets you reduce incident retention to 30 days and audit retention to 90 days. Cleanup runs in the background; choosing a shorter period does not replace the immediate account-deletion control.</p> },
    ],
  },
};

export default function LegalPage({ kind }: { kind: LegalKind }) {
  const page = content[kind];
  const back = native ? "/" : "/landing";
  return (
    <main className="legal-page">
      <header>
        <a className="legal-brand" href={back}><span><SpatialGuardMark size={19} /></span>Pathlight</a>
        <a href={back}><ArrowLeft size={15} />Back</a>
      </header>
      <article>
        <p className="eyebrow">Effective September 21, 2026</p>
        <h1>{page.title}</h1>
        <p className="legal-intro">{page.intro}</p>
        {page.sections.map(section => <section key={section.title}><h2>{section.title}</h2>{section.body}</section>)}
      </article>
      <nav aria-label="Legal pages"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/data-deletion">Data deletion</a></nav>
    </main>
  );
}
