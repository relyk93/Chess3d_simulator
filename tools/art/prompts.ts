import { DesignError, type Design } from './design';

/** Framing that keeps every concept usable as a chess piece: one centered figure on a base. */
const FRAMING =
  'Single figure, full body, centered, front view, plain neutral background, standing on a small round stone base, symmetrical, no text';

const clean = (s: string) => s.trim().replace(/[.\s]+$/, '');

export function buildPrompt(design: Design, pieceKey: string): string {
  const piece = design.pieces[pieceKey];
  if (!piece) throw new DesignError('pieces', `unknown piece "${pieceKey}"`);
  const side = pieceKey.startsWith('w-') ? 'w' : 'b';
  return [design.style, design.sideLook[side], piece.subject, FRAMING].map(clean).join('. ') + '.';
}
