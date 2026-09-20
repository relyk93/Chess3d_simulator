import { useActions, useController } from '../controller/context';

export function SettingsDrawer() {
  const settings = useController((s) => s.settings);
  const engineStatus = useController((s) => s.engineStatus);
  const { updateSettings } = useActions();
  return (
    <div className="drawer" role="group" aria-label="Settings">
      <label>
        Difficulty ({settings.skill})
        <input
          type="range"
          min={1}
          max={20}
          value={settings.skill}
          onChange={(e) => updateSettings({ skill: Number(e.target.value) })}
          disabled={settings.twoPlayer}
        />
      </label>
      <label>
        Cinematics
        <input type="checkbox" checked={settings.cinematics} onChange={(e) => updateSettings({ cinematics: e.target.checked })} />
      </label>
      <label>
        Sound
        <input type="checkbox" checked={settings.sound} onChange={(e) => updateSettings({ sound: e.target.checked })} />
      </label>
      <label>
        Two player (no engine)
        <input
          type="checkbox"
          checked={settings.twoPlayer}
          disabled={engineStatus === 'failed'}
          onChange={(e) => updateSettings({ twoPlayer: e.target.checked })}
        />
      </label>
    </div>
  );
}
