import { readFileSync } from 'node:fs';
import { FALLBACK_BOARD, FALLBACK_SET } from './fallback';
import { loadActivePacks, loadBoardPack, loadSetPack, packUrl, type Fetch } from './loader';
import { ALL_PIECE_KEYS, pieceKey } from './types';
import { ManifestError, parseBoardManifest, parseSetManifest } from './validate';

const read = (rel: string) => JSON.parse(readFileSync(`public/packs/${rel}`, 'utf8')) as unknown;
const goodSet = () => structuredClone(read('sets/angels-vs-demons/manifest.json')) as Record<string, any>;
const goodBoard = () => structuredClone(read('boards/stone-lava/manifest.json')) as Record<string, any>;

describe('parseSetManifest', () => {
  test('accepts the shipped dev pack manifest', () => {
    const m = parseSetManifest(goodSet());
    expect(m.id).toBe('angels-vs-demons');
    expect(Object.keys(m.pieces).sort()).toEqual([...ALL_PIECE_KEYS].sort());
    expect(m.pieces['w-king']!.clips).toEqual(['idle', 'attack', 'hit', 'die', 'victory']);
    expect(m.pieces['w-pawn']!.clips).toEqual([]);
    expect(m.sides.b.impactEffect).toBe('fire');
  });

  test('pieceKey builds manifest keys', () => {
    expect(pieceKey('w', 'k')).toBe('w-king');
    expect(pieceKey('b', 'n')).toBe('b-knight');
  });

  test.each([
    ['a missing piece', (m: any) => { delete m.pieces['b-rook']; }, /pieces\.b-rook: expected an object/],
    ['an impact effect outside the enum', (m: any) => { m.sides.w.impactEffect = 'plasma'; }, /sides\.w\.impactEffect: expected one of light, fire, ice, shadow, sparks/],
    ['a non-hex side color', (m: any) => { m.sides.b.color = 'red'; }, /sides\.b\.color: expected a #rrggbb color/],
    ['an unknown clip name', (m: any) => { m.pieces['w-king'].clips.push('dance'); }, /pieces\.w-king\.clips\[5\]/],
    ['an unknown sound name', (m: any) => { m.audio.boom = 'audio/boom.ogg'; }, /audio\.boom/],
    ['a missing model path', (m: any) => { m.pieces['w-pawn'].model = ''; }, /pieces\.w-pawn\.model/],
    ['a non-null sequenceOverride', (m: any) => { m.sequenceOverride = {}; }, /sequenceOverride/],
    ['a non-object manifest', () => 42, /set manifest: expected an object/],
  ])('rejects %s with a message that names the field', (_name, mutate, message) => {
    const m = goodSet();
    const replaced = mutate(m);
    const input = replaced === undefined ? m : replaced;
    expect(() => parseSetManifest(input)).toThrow(ManifestError);
    expect(() => parseSetManifest(input)).toThrow(message);
  });

  test('audio is optional', () => {
    const m = goodSet();
    delete m.audio;
    expect(parseSetManifest(m).audio).toEqual({});
  });
});

describe('parseBoardManifest', () => {
  test('accepts the shipped dev pack manifest', () => {
    const m = parseBoardManifest(goodBoard());
    expect(m.squares.light).toBe('#8c8378');
    expect(m.ambient).toEqual({ type: 'lava-cracks', intensity: 0.6 });
  });

  test.each([
    ['an unknown ambient type', (m: any) => { m.ambient.type = 'snow'; }, /ambient\.type: expected one of none, lava-cracks/],
    ['a bad square color', (m: any) => { m.squares.dark = '#12'; }, /squares\.dark/],
    ['a missing model', (m: any) => { delete m.model; }, /model: expected a non-empty string/],
    ['a non-numeric intensity', (m: any) => { m.ambient.intensity = 'high'; }, /ambient\.intensity/],
  ])('rejects %s', (_n, mutate, message) => {
    const m = goodBoard();
    mutate(m);
    expect(() => parseBoardManifest(m)).toThrow(message);
  });
});

describe('loader', () => {
  const okFetch = (files: Record<string, unknown>): Fetch => async (url) =>
    url in files ? { ok: true, status: 200, json: async () => files[url] } : { ok: false, status: 404, json: async () => ({}) };

  test('packUrl joins relative paths and leaves empty paths empty', () => {
    expect(packUrl('/packs/sets/x', 'models/w-king.glb')).toBe('/packs/sets/x/models/w-king.glb');
    expect(packUrl('/packs/sets/x', './board.glb')).toBe('/packs/sets/x/board.glb');
    expect(packUrl('/packs/sets/x', '')).toBe('');
  });

  test('loadSetPack fetches and validates <root>/sets/<id>/manifest.json', async () => {
    const pack = await loadSetPack('angels-vs-demons', okFetch({ '/packs/sets/angels-vs-demons/manifest.json': goodSet() }));
    expect(pack.baseUrl).toBe('/packs/sets/angels-vs-demons');
    expect(pack.manifest.name).toBe('Angels vs Demons');
  });

  test('loadBoardPack fetches and validates <root>/boards/<id>/manifest.json', async () => {
    const pack = await loadBoardPack('stone-lava', okFetch({ '/packs/boards/stone-lava/manifest.json': goodBoard() }));
    expect(pack.manifest.model).toBe('board.glb');
  });

  test('an HTTP error rejects with the URL and status', async () => {
    await expect(loadSetPack('nope', okFetch({}))).rejects.toThrow('/packs/sets/nope/manifest.json returned HTTP 404');
  });

  test('loadActivePacks falls back per pack, warning once each, and never rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const both = await loadActivePacks(okFetch({}));
    expect(both.set).toBe(FALLBACK_SET);
    expect(both.board).toBe(FALLBACK_BOARD);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockClear();
    const oneBad = await loadActivePacks(okFetch({ '/packs/boards/stone-lava/manifest.json': goodBoard() }));
    expect(oneBad.set).toBe(FALLBACK_SET);
    expect(oneBad.board.manifest.id).toBe('stone-lava');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('a malformed manifest also falls back instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = goodSet();
    bad.sides.w.impactEffect = 'plasma';
    const { set } = await loadActivePacks(okFetch({ '/packs/sets/angels-vs-demons/manifest.json': bad }));
    expect(set).toBe(FALLBACK_SET);
    warn.mockRestore();
  });

  test('the fallback packs are themselves valid manifests', () => {
    expect(() => parseSetManifest({ ...FALLBACK_SET.manifest, pieces: Object.fromEntries(ALL_PIECE_KEYS.map((k) => [k, { model: 'x', clips: [] }])) })).not.toThrow();
    expect(() => parseBoardManifest({ ...FALLBACK_BOARD.manifest, model: 'x', environment: 'x' })).not.toThrow();
  });
});
