import { useActions, useController } from '../controller/context';
import type { Color, GameOverReason } from '../core/types';

function describe(reason: GameOverReason, sideToMove: Color): { title: string; detail: string } {
  if (reason === 'checkmate') {
    const winner = sideToMove === 'w' ? 'Black' : 'White';
    return { title: 'Checkmate', detail: `${winner} wins` };
  }
  const labels: Record<Exclude<GameOverReason, 'checkmate'>, string> = {
    stalemate: 'Stalemate',
    insufficient: 'Insufficient material',
    threefold: 'Threefold repetition',
    'fifty-move': 'Fifty-move rule',
  };
  return { title: 'Draw', detail: labels[reason] };
}

export function GameOverBanner() {
  const gameOver = useController((s) => s.gameOver);
  const turn = useController((s) => s.turn);
  const phase = useController((s) => s.phase);
  const { newGame } = useActions();
  if (phase !== 'gameOver' || !gameOver) return null;
  const { title, detail } = describe(gameOver, turn);
  return (
    <div className="banner" role="dialog" aria-label="Game over">
      <h2>{title}</h2>
      <div>{detail}</div>
      <button className="btn" onClick={newGame}>New Game</button>
    </div>
  );
}
