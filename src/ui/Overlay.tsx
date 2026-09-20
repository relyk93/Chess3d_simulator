import { useState } from 'react';
import { useActions, useController } from '../controller/context';
import { TopBar } from './TopBar';
import { MoveList } from './MoveList';
import { SettingsDrawer } from './SettingsDrawer';
import { GameOverBanner } from './GameOverBanner';
import { PromotionDialog } from './PromotionDialog';
import './overlay.css';

export function Overlay({ onResetView }: { onResetView: () => void }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const phase = useController((s) => s.phase);
  const engineError = useController((s) => s.engineError);
  const { skipCinematic } = useActions();
  return (
    <div className="overlay">
      <TopBar onResetView={onResetView} onToggleSettings={() => setSettingsOpen((o) => !o)} />
      <MoveList />
      {settingsOpen && <SettingsDrawer />}
      {phase === 'cinematic' && <button className="btn skip" onClick={skipCinematic}>Skip</button>}
      {engineError && <div className="error" role="alert">Engine unavailable ({engineError}). Two-player mode enabled.</div>}
      <GameOverBanner />
      <PromotionDialog />
    </div>
  );
}
