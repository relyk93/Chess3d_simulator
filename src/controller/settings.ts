export interface Settings {
  skill: number;
  cinematics: boolean;
  sound: boolean;
  twoPlayer: boolean;
}

export const DEFAULT_SETTINGS: Settings = { skill: 5, cinematics: true, sound: true, twoPlayer: false };
export const SETTINGS_KEY = 'chess3d.settings';

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | null = defaultStorage()): Settings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SETTINGS };
    const p = parsed as Record<string, unknown>;
    return {
      skill: typeof p.skill === 'number' ? Math.max(1, Math.min(20, p.skill)) : DEFAULT_SETTINGS.skill,
      cinematics: typeof p.cinematics === 'boolean' ? p.cinematics : DEFAULT_SETTINGS.cinematics,
      sound: typeof p.sound === 'boolean' ? p.sound : DEFAULT_SETTINGS.sound,
      twoPlayer: typeof p.twoPlayer === 'boolean' ? p.twoPlayer : DEFAULT_SETTINGS.twoPlayer,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings, storage: Pick<Storage, 'setItem'> | null = defaultStorage()): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable; settings simply won't persist
  }
}
