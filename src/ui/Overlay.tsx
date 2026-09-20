import { useState } from 'react';
import { useActions, useController } from '../controller/context';
import { TopBar } from './TopBar';
import { MoveList } from './MoveList';
import { SettingsDrawer } from './SettingsDrawer';
import { GameOverBanner } from './GameOverBanner';
import { PromotionDialog } from './PromotionDialog';
import { ContextLostOverlay } from './ContextLostOverlay';
import './overlay.css';

interface Props {
  onResetView: () => void;
  /** True while the in-scene 3D promotion picker is available; the HTML dialog is then hidden. */
  scenePromotion?: boolean;
  contextLost?: boolean;
}

export function Overlay({ onResetView, scenePromotion = false, contextLost = false }: Props) {
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
      {!scenePromotion && <PromotionDialog />}
      {contextLost && <ContextLostOverlay />}
    </div>
  );
}
