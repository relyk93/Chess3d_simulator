// @vitest-environment node
import { defaultDesign, DesignError, parseDesign, poseModeFor } from './design';
import { ALL_PIECE_KEYS } from './spec';

const roundTrip = () => JSON.parse(JSON.stringify(defaultDesign())) as Record<string, any>;

describe('defaultDesign', () => {
  test('describes all twelve pieces, with the four figure types rigged on both sides', () => {
    const d = defaultDesign();
    expect(Object.keys(d.pieces).sort()).toEqual([...ALL_PIECE_KEYS].sort());
    const rigged = Object.entries(d.pieces).filter(([, p]) => p.rigged).map(([k]) => k).sort();
    expect(rigged).toEqual(['b-bishop', 'b-king', 'b-knight', 'b-queen', 'w-bishop', 'w-king', 'w-knight', 'w-queen']);
  });

  test('knows only the one documented action id and leaves the rest for the user to look up', () => {
    expect(defaultDesign().actions).toEqual({ idle: null, attack: 4, hit: null, die: null, victory: null });
  });

  test('has no image-to-3d cost, because Meshy does not document one', () => {
    expect(defaultDesign().credits.imageTo3d).toBeNull();
  });

  test('survives a JSON round trip through the parser', () => {
    expect(parseDesign(roundTrip())).toEqual(defaultDesign());
  });
});

describe('parseDesign', () => {
  test('rejects a non-object', () => {
    expect(() => parseDesign('nope')).toThrow(/design\.json: expected an object/);
  });

  test('a missing piece is named', () => {
    const j = roundTrip();
    delete j.pieces['w-pawn'];
    expect(() => parseDesign(j)).toThrow(/design\.json pieces: missing w-pawn/);
  });

  test('an unknown piece is named', () => {
    const j = roundTrip();
    j.pieces['w-dragon'] = { subject: 'x', rigged: false };
    expect(() => parseDesign(j)).toThrow(/design\.json pieces: unknown piece "w-dragon"/);
  });

  test('a misspelled top-level field is caught, not ignored', () => {
    const j = roundTrip();
    j.targetPolyCount = 9000;
    expect(() => parseDesign(j)).toThrow(/design\.json: unknown field "targetPolyCount"/);
  });

  test.each([50, 400000, 1500.5, 'lots'])('targetPolycount %s is rejected', (value) => {
    const j = roundTrip();
    j.targetPolycount = value;
    expect(() => parseDesign(j)).toThrow(/design\.json targetPolycount: expected a whole number from 100 to 300000/);
  });

  test('an action id must be a whole number or null', () => {
    const j = roundTrip();
    j.actions.idle = 1.5;
    expect(() => parseDesign(j)).toThrow(/design\.json actions\.idle: expected a whole number or null/);
  });

  test('an unknown action name is named', () => {
    const j = roundTrip();
    j.actions.dance = 3;
    expect(() => parseDesign(j)).toThrow(/design\.json actions: unknown clip "dance"/);
  });

  test('a bad impact effect is named', () => {
    const j = roundTrip();
    j.sides.w.impactEffect = 'glitter';
    expect(() => parseDesign(j)).toThrow(/design\.json sides\.w\.impactEffect: expected one of/);
  });

  test('rigged must be a boolean', () => {
    const j = roundTrip();
    j.pieces['w-king'].rigged = 'yes';
    expect(() => parseDesign(j)).toThrow(/design\.json pieces\.w-king\.rigged: expected true or false/);
  });

  test('a piece needs a subject', () => {
    const j = roundTrip();
    j.pieces['b-rook'].subject = '';
    expect(() => parseDesign(j)).toThrow(/design\.json pieces\.b-rook\.subject: expected a non-empty string/);
  });

  test('an unknown sound name in audio is named', () => {
    const j = roundTrip();
    j.audio = { boom: 'audio/boom.wav' };
    expect(() => parseDesign(j)).toThrow(/design\.json audio: unknown sound "boom"/);
  });

  test('a null image-to-3d cost or a number are both fine', () => {
    const j = roundTrip();
    j.credits.imageTo3d = 30;
    expect(parseDesign(j).credits.imageTo3d).toBe(30);
    j.credits.imageTo3d = -1;
    expect(() => parseDesign(j)).toThrow(/design\.json credits\.imageTo3d/);
  });
});

describe('poseModeFor', () => {
  test('rigged figures are generated in an A-pose so they rig cleanly; rigid pieces have none', () => {
    const d = defaultDesign();
    expect(poseModeFor(d.pieces['w-king']!)).toBe('a-pose');
    expect(poseModeFor(d.pieces['w-rook']!)).toBeUndefined();
  });
});
