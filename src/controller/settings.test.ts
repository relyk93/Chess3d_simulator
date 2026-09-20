import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, saveSettings } from './settings';

beforeEach(() => localStorage.clear());

test('loadSettings returns defaults when nothing is stored', () => {
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
});

test('saveSettings then loadSettings round-trips', () => {
  saveSettings({ skill: 12, cinematics: false, sound: true, twoPlayer: true });
  expect(loadSettings()).toEqual({ skill: 12, cinematics: false, sound: true, twoPlayer: true });
});

test('loadSettings merges partial or malformed stored values with defaults', () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ skill: 'high', sound: false }));
  expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, sound: false });
  localStorage.setItem(SETTINGS_KEY, 'not json');
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
});

test('storage errors are swallowed', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
  expect(() => saveSettings(DEFAULT_SETTINGS, broken)).not.toThrow();
});
