import { useEffect, useRef } from "react";

/** Single registration scope for a floating control, with a complete teardown. */
export function registerDismissListeners<T extends HTMLElement>(
  source: Pick<Document, "addEventListener" | "removeEventListener">,
  ref: { current: T | null },
  onDismiss: () => void,
) {
  const onPointerDown = (event: PointerEvent) => {
    if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") onDismiss();
  };
  source.addEventListener("pointerdown", onPointerDown as EventListener);
  source.addEventListener("keydown", onKeyDown as EventListener);
  return () => {
    source.removeEventListener("pointerdown", onPointerDown as EventListener);
    source.removeEventListener("keydown", onKeyDown as EventListener);
  };
}

/** Closes a floating control on outside pointer interaction or Escape. */
export function useDismissable<T extends HTMLElement>(open: boolean, onDismiss: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    return registerDismissListeners(document, ref, onDismiss);
  }, [open, onDismiss]);
  return ref;
}
