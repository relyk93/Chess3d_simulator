import { useEffect } from 'react';

/** Calls `onCancel` when Escape is pressed while `active`. */
export function useEscapeToCancel(active: boolean, onCancel: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, onCancel]);
}
