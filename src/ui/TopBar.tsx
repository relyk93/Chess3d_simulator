import { useActions, useController } from '../controller/context';

export function TopBar({ onResetView, onToggleSettings }: { onResetView: () => void; onToggleSettings: () => void }) {
  const { newGame, undo } = useActions();
  const phase = useController((s) => s.phase);
  const canUndo = useController((s) => s.history.length > 0 && !['promoting', 'animatingMove', 'cinematic'].includes(s.phase));
  return (
    <div className="topbar">
      <button className="btn" onClick={newGame}>New Game</button>
      <button className="btn" onClick={undo} disabled={!canUndo}>Undo</button>
      <button className="btn" onClick={onResetView}>Reset View</button>
      <button className="btn" onClick={onToggleSettings}>Settings</button>
      <span className="btn" style={{ cursor: 'default' }} aria-live="polite">
        {phase === 'engineThinking' ? 'Thinking…' : phase === 'gameOver' ? 'Game over' : ''}
      </span>
    </div>
  );
}
