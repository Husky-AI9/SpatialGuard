import { useState } from "react";
import { ArrowLeft, ArrowRight, Camera, Check, Map, Shield } from "lucide-react";
import { useDialogFocus } from "./useDialogFocus";
import RecoveryNotice from "./RecoveryNotice";

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
      <p className="eyebrow">Your SpatialGuard workspace</p>
      <h2>One place to understand camera events</h2>
      <p>Your SpatialGuard email account is separate from Ring. SpatialGuard never asks for or stores your Ring password. Ring authorization happens on Ring’s own linking page.</p>
      <ul>
        <li><Check size={16} />Incidents stay tied to the map revision used when they happened.</li>
        <li><Check size={16} />Replay, live events, and estimates are always labelled separately.</li>
        <li><Check size={16} />You control retention and can delete the account from Settings.</li>
      </ul>
    </div>,
    <div className="onboarding-copy" key="consent">
      <span className="onboarding-icon"><Camera size={24} /></span>
      <p className="eyebrow">Choose what SpatialGuard may use</p>
      <h2>Ring access starts only after you allow it</h2>
      <label className="consent-choice">
        <input type="checkbox" checked={draft.ring_data_consent}
          onChange={(event) => setDraft({ ...draft, ring_data_consent: event.target.checked,
            classification_consent: event.target.checked ? draft.classification_consent : false })} />
        <span><strong>Use authorized Ring data</strong><small>Inventory, snapshots, live video, signed events, device status, and time-lapse captures.</small></span>
      </label>
      <label className="consent-choice">
        <input type="checkbox" disabled={!draft.ring_data_consent} checked={draft.classification_consent}
          onChange={(event) => setDraft({ ...draft, classification_consent: event.target.checked })} />
        <span><strong>Analyze event snapshots</strong><small>Send up to three authorized event snapshots to the configured OpenAI model for a cautious, reviewable category. No face identification or gender inference.</small></span>
      </label>
      <p className="fine">Both choices are optional and can be changed in Privacy settings.</p>
    </div>,
    <div className="onboarding-copy" key="map">
      <span className="onboarding-icon"><Map size={24} /></span>
      <p className="eyebrow">Build the home context</p>
      <h2>Add a floor plan, then place each camera</h2>
      <p>The map explains which camera observed an event. Without camera calibration, SpatialGuard does not claim an exact person position or movement path.</p>
      <div className="onboarding-map-actions">
        <button className="primary" onClick={onUploadPlan}>Upload my floor plan</button>
        <button onClick={onLoadSample}>Explore the synthetic demo</button>
      </div>
    </div>,
    <div className="onboarding-copy" key="evidence">
      <span className="onboarding-icon"><Shield size={24} /></span>
      <p className="eyebrow">Read the evidence honestly</p>
      <h2>Observed does not mean tracked</h2>
      <div className="onboarding-evidence">
        <span><i className="evidence-observed" /><strong>Observed</strong><small>A mapped camera reported the event.</small></span>
        <span><i className="evidence-possible" /><strong>Possible continuation</strong><small>Another camera reported activity within five minutes.</small></span>
        <span><i className="evidence-unknown">?</i><strong>Unknown gap</strong><small>No camera evidence establishes the route or identity between them.</small></span>
      </div>
      <p>SpatialGuard keeps uncertainty visible so an incident can be reviewed without turning a camera event into a false location claim.</p>
    </div>,
  ];

  return (
    <div className="modal-backdrop onboarding-backdrop" role="presentation">
      <section {...dialog} className="onboarding-dialog" role="dialog" aria-modal="true" aria-label="SpatialGuard setup">
        <header>
          <span>SpatialGuard setup</span>
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
