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
      effect: "Your data didn’t load.",
      action: "Sign in again, then return to this screen.",
    };
  if (/timeout|timed out|network|fetch|reach|connect/.test(value))
    return {
      cause: "Pathlight could not reach the service",
      effect: "What you see may be out of date.",
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
      effect: "The live view was closed.",
      action: "Close any other live view, then start this camera again.",
    };
  if (/privacy|masked|permission|forbidden/.test(value))
    return {
      cause: "Ring privacy or permission settings blocked this action",
      effect: "Nothing was shown.",
      action: "Review the camera settings in Ring before trying again.",
    };
  return {
    cause: "That action did not finish",
    effect: "No successful update was recorded.",
    action: "Try again.",
  };
}

export default function RecoveryNotice({ message, onRetry, retryLabel = "Try again" }: RecoveryNoticeProps) {
  const copy = recoveryCopy(message);
  return <div className="recovery-notice" role="alert">
    <AlertTriangle size={20} aria-hidden="true" />
    <div>
      <strong>{copy.cause}</strong>
      <small>{copy.action}</small>
      <details><summary>Technical detail</summary><code>{message}</code></details>
    </div>
    {onRetry && <button type="button" onClick={onRetry}><RefreshCw size={15} aria-hidden="true" />{retryLabel}</button>}
  </div>;
}
