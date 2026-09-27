import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Map, Shield } from "lucide-react";
import { useDialogFocus } from "./useDialogFocus";
import RecoveryNotice from "./RecoveryNotice";
import CameraMark from "./CameraMark";

export type AccountPreferences = {
  onboarding_completed: boolean;
  ring_data_consent: boolean;
  classification_consent: boolean;
  incident_retention_days: 30 | 90 | 365;
  audit_retention_days: 90 | 365 | 730;
  consent_updated_at: string | null;
};

export default function Onboarding({
  preferences,
  onSave,
  onLoadSample,
  onUploadPlan,
  onOpenSettings,
}: {
  preferences: AccountPreferences;
  onSave: (next: AccountPreferences) => Promise<void>;
  onLoadSample: () => void;
  onUploadPlan: () => void;
  onOpenSettings: () => void;
}) {
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState(preferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const finish = async (openSettings = false) => {
    setBusy(true);
    setError("");
    try {
      await onSave({ ...draft, onboarding_completed: true });
      if (openSettings) onOpenSettings();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save your choices");
      setBusy(false);
    }
  };
  const dialog = useDialogFocus(true, () => void finish(false), !busy);
  const pages = [
    <div className="onboarding-copy" key="account">
      <span className="onboarding-icon"><Shield size={24} /></span>
      <h2>Welcome to SpatialGuard</h2>
      <p>See what your cameras saw, and where, on a map of your home.</p>
      <ul>
        <li><Check size={16} />Your Ring password is never shared with us.</li>
        <li><Check size={16} />You choose what data we can use.</li>
        <li><Check size={16} />Delete your data anytime.</li>
      </ul>
    </div>,
    <div className="onboarding-copy" key="consent">
      <span className="onboarding-icon"><CameraMark size={24} /></span>
      <h2>Choose what we can use</h2>
      <label className="consent-choice">
        <input type="checkbox" checked={draft.ring_data_consent}
          onChange={(event) => setDraft({ ...draft, ring_data_consent: event.target.checked,
            classification_consent: event.target.checked ? draft.classification_consent : false })} />
        <span><strong>Ring cameras</strong><small>Live view, events and camera status.</small></span>
      </label>
      <label className="consent-choice">
        <input type="checkbox" disabled={!draft.ring_data_consent} checked={draft.classification_consent}
          onChange={(event) => setDraft({ ...draft, classification_consent: event.target.checked })} />
        <span><strong>Activity labels</strong><small>Event snapshots are sent to OpenAI to label activity. No face recognition.</small></span>
      </label>
      <p className="fine">You can change these later in Settings.</p>
    </div>,
    <div className="onboarding-copy" key="map">
      <span className="onboarding-icon"><Map size={24} /></span>
      <h2>Add your floor plan</h2>
      <p>Upload a drawing of your home, then place your cameras on it.</p>
      <div className="onboarding-map-actions">
        <button className="primary" onClick={onUploadPlan}>Upload floor plan</button>
        <button onClick={onLoadSample}>Try the demo home</button>
      </div>
    </div>,
  ];

  return (
    <div className="modal-backdrop onboarding-backdrop" role="presentation">
      <section {...dialog} className="onboarding-dialog" role="dialog" aria-modal="true" aria-label="SpatialGuard setup">
        <header>
          <span>Setup</span>
          <span>{page + 1} of {pages.length}</span>
        </header>
        <div>{pages[page]}</div>
        {error && <RecoveryNotice message={error} onRetry={() => void finish(draft.ring_data_consent)} retryLabel="Save again" />}
        <footer>
          <button className="quiet" disabled={busy} onClick={() => void finish(false)}>Skip setup</button>
          <div className="button-row">
            {page > 0 && <button disabled={busy} onClick={() => setPage(page - 1)}><ArrowLeft size={16} />Back</button>}
            {page < pages.length - 1 ? (
              <button className="primary" disabled={busy} onClick={() => setPage(page + 1)}>Continue<ArrowRight size={16} /></button>
            ) : (
              <button className="primary" disabled={busy} onClick={() => void finish(draft.ring_data_consent)}>
                {busy ? "Saving…" : "Open SpatialGuard"}<ArrowRight size={16} />
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
