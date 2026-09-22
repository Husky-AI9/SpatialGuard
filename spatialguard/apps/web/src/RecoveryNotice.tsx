import { AlertTriangle, RefreshCw } from "lucide-react";

type RecoveryNoticeProps = {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
};

export function recoveryCopy(message: string) {
  const value = message.toLowerCase();
  if (/session|sign.?in|unauthor|credential/.test(value))
    return {
      cause: "Your session needs attention",
      effect: "SpatialGuard stopped loading private camera and incident data.",
      action: "Sign in again, then return to this screen.",
    };
  if (/timeout|timed out|network|fetch|reach|connect/.test(value))
    return {
      cause: "SpatialGuard could not reach the service",
      effect: "What you see may be stale; no new monitoring result is implied.",
      action: "Check your connection and try again.",
    };
  if (/offline|unavailable/.test(value))
    return {
      cause: "This camera or service is unavailable",
      effect: "Live video and new evidence cannot load right now.",
      action: "Check the camera in Ring, then retry here.",
    };
  if (/already open|already closed|another.*active|conflict/.test(value))
    return {
      cause: "The camera session changed",
      effect: "SpatialGuard closed this view instead of showing an uncertain stream state.",
      action: "Close any other live view, then start this camera again.",
    };
  if (/privacy|masked|permission|forbidden/.test(value))
    return {
      cause: "Ring privacy or permission settings blocked this action",
      effect: "SpatialGuard did not display or process the protected media.",
      action: "Review the camera settings in Ring before trying again.",
    };
  return {
    cause: "That action did not finish",
    effect: "No successful update was recorded.",
    action: "Try again. If it repeats, open Settings and check the Ring connection.",
  };
}

export default function RecoveryNotice({ message, onRetry, retryLabel = "Try again" }: RecoveryNoticeProps) {
  const copy = recoveryCopy(message);
  return <div className="recovery-notice" role="alert">
    <AlertTriangle size={20} aria-hidden="true" />
    <div>
      <strong>{copy.cause}</strong>
      <p>{copy.effect}</p>
      <small>{copy.action}</small>
      <details><summary>Technical detail</summary><code>{message}</code></details>
    </div>
    {onRetry && <button type="button" onClick={onRetry}><RefreshCw size={15} aria-hidden="true" />{retryLabel}</button>}
  </div>;
}
