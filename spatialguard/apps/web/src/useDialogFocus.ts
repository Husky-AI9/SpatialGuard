import { useEffect, useRef } from "react";

const SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useDialogFocus(
  active: boolean,
  close: () => void,
  canClose = true,
) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current.querySelector<HTMLElement>(SELECTOR);
    (first ?? ref.current).focus();
    return () => previous?.focus();
  }, [active]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && canClose) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || !ref.current) return;
    const focusable = [...ref.current.querySelectorAll<HTMLElement>(SELECTOR)];
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return { ref, onKeyDown, tabIndex: -1 };
}
