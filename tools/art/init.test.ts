// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultDesign, loadDesign } from './design';
import { InitError, initSet } from './init';

const tmp = () => mkdtempSync(join(tmpdir(), 'init-'));

describe('initSet', () => {
  test('creates the folder and a design.json that validates', () => {
    const dir = join(tmp(), 'art-src', 'angels-vs-demons');
    const result = initSet(dir, { devAudioDir: join(tmp(), 'no-audio-here') });
    expect(result.designPath).toBe(join(dir, 'design.json'));
    expect(loadDesign(dir)).toEqual(defaultDesign());
  });

  test('refuses to overwrite an existing design.json, and leaves it alone', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'design.json'), 'my edits');
    expect(() => initSet(dir, { devAudioDir: '/nope' })).toThrow(InitError);
    expect(() => initSet(dir, { devAudioDir: '/nope' })).toThrow(/design\.json already exists/);
    expect(readFileSync(join(dir, 'design.json'), 'utf8')).toBe('my edits');
  });

  test('carries the dev pack placeholder sounds over, so the real set is not silent', () => {
    const dev = tmp();
    for (const name of ['attack', 'hit', 'die']) writeFileSync(join(dev, `${name}.wav`), `wav-${name}`);
    const dir = tmp();
    const result = initSet(dir, { devAudioDir: dev });
    expect(result.copied.sort()).toEqual(['audio/attack.wav', 'audio/die.wav', 'audio/hit.wav']);
    expect(readFileSync(join(dir, 'audio', 'hit.wav'), 'utf8')).toBe('wav-hit');
    expect(loadDesign(dir).audio).toEqual({ attack: 'audio/attack.wav', hit: 'audio/hit.wav', die: 'audio/die.wav' });
  });

  test('lists only the sounds that exist', () => {
    const dev = tmp();
    writeFileSync(join(dev, 'attack.wav'), 'x');
    const dir = tmp();
    initSet(dir, { devAudioDir: dev });
    expect(loadDesign(dir).audio).toEqual({ attack: 'audio/attack.wav' });
  });

  test('with no dev audio folder the design has no audio and nothing is copied', () => {
    const dir = tmp();
    const result = initSet(dir, { devAudioDir: join(tmp(), 'missing') });
    expect(result.copied).toEqual([]);
    expect(existsSync(join(dir, 'audio'))).toBe(false);
    expect(loadDesign(dir).audio).toEqual({});
  });
});
