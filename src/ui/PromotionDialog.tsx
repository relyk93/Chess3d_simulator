import { useActions, useController } from '../controller/context';
import type { PromotionPiece } from '../core/types';
import { useEscapeToCancel } from './useEscapeToCancel';

const CHOICES: { piece: PromotionPiece; label: string }[] = [
  { piece: 'q', label: 'Queen' },
  { piece: 'r', label: 'Rook' },
  { piece: 'b', label: 'Bishop' },
  { piece: 'n', label: 'Knight' },
];

/** HTML promotion picker. Used when the in-scene 3D picker is unavailable (no canvas, or WebGL context lost). */
export function PromotionDialog() {
  const phase = useController((s) => s.phase);
  const { choosePromotion, cancelPromotion } = useActions();
  const open = phase === 'promoting';
  useEscapeToCancel(open, cancelPromotion);

  if (!open) return null;
  return (
    <div className="promo" role="dialog" aria-label="Choose promotion">
      {CHOICES.map((c) => (
        <button key={c.piece} className="btn" onClick={() => choosePromotion(c.piece)}>{c.label}</button>
      ))}
    </div>
  );
}
