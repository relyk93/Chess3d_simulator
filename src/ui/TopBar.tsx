import { useActions, useController } from '../controller/context';

export function TopBar({ onResetView, onToggleSettings }: { onResetView: () => void; onToggleSettings: () => void }) {
  const { newGame, undo } = useActions();
  const phase = useController((s) => s.phase);
  const canUndo = useController((s) => s.history.length > 0 && !['promoting', 'animatingMove', 'cinematic'].includes(s.phase));
  const status = phase === 'engineThinking' ? 'Thinking…' : phase === 'gameOver' ? 'Game over' : '';
  return (
    <div className="topbar">
      <button className="btn" onClick={newGame}>New Game</button>
      <button className="btn" onClick={undo} disabled={!canUndo}>Undo</button>
      <button className="btn" onClick={onResetView}>Reset View</button>
      <button className="btn" onClick={onToggleSettings}>Settings</button>
      <span aria-live="polite">
        {status && <span className="btn" style={{ cursor: 'default' }}>{status}</span>}
      </span>
    </div>
  );
}
