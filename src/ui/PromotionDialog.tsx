import { useEffect } from 'react';
import { useActions, useController } from '../controller/context';
import type { PromotionPiece } from '../core/types';

const CHOICES: { piece: PromotionPiece; label: string }[] = [
  { piece: 'q', label: 'Queen' },
  { piece: 'r', label: 'Rook' },
  { piece: 'b', label: 'Bishop' },
  { piece: 'n', label: 'Knight' },
];

export function PromotionDialog() {
  const phase = useController((s) => s.phase);
  const { choosePromotion, cancelPromotion } = useActions();
  const open = phase === 'promoting';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelPromotion(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, cancelPromotion]);

  if (!open) return null;
  return (
    <div className="promo" role="dialog" aria-label="Choose promotion">
      {CHOICES.map((c) => (
        <button key={c.piece} className="btn" onClick={() => choosePromotion(c.piece)}>{c.label}</button>
      ))}
    </div>
  );
}
