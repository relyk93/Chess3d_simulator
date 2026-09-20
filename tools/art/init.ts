import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SOUND_NAMES } from '../../src/packs/types';
import { defaultDesign } from './design';

export class InitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InitError';
  }
}

export interface InitOptions {
  /** Where the dev pack's placeholder sounds live. Default: the committed dev pack. */
  devAudioDir?: string;
}

export interface InitResult {
  designPath: string;
  /** Sound files copied into the set folder, relative to it. */
  copied: string[];
}

const DEV_AUDIO_DIR = 'public/packs/sets/angels-vs-demons/audio';

/**
 * Starts a set's source folder: writes `design.json` from the defaults and carries the dev pack's
 * placeholder sounds over, so replacing the dev set with real art does not silently drop sound.
 * Never overwrites an existing `design.json`.
 */
export function initSet(dir: string, opts: InitOptions = {}): InitResult {
  const designPath = join(dir, 'design.json');
  if (existsSync(designPath)) {
    throw new InitError(`${designPath}: design.json already exists; edit it, or delete it to start over`);
  }
  mkdirSync(dir, { recursive: true });

  const design = defaultDesign();
  const copied: string[] = [];
  const devDir = opts.devAudioDir ?? DEV_AUDIO_DIR;
  for (const sound of SOUND_NAMES) {
    const from = join(devDir, `${sound}.wav`);
    if (!existsSync(from)) continue;
    mkdirSync(join(dir, 'audio'), { recursive: true });
    copyFileSync(from, join(dir, 'audio', `${sound}.wav`));
    design.audio[sound] = `audio/${sound}.wav`;
    copied.push(`audio/${sound}.wav`);
  }

  writeFileSync(designPath, JSON.stringify(design, null, 2) + '\n');
  return { designPath, copied };
}
