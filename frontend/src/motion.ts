import { useEffect, useRef, useState } from "react";

export function useDismiss(close: () => void) {
  const [leaving, setLeaving] = useState(false),
    timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  return {
    leaving,
    dismiss: () => {
      if (leaving) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        close();
        return;
      }
      setLeaving(true);
      timer.current = setTimeout(close, 180);
    },
  };
}
