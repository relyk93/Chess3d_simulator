import { parseArgs } from 'node:util';
import type { NormalizeOptions } from './normalize';
import { CLIP_NAMES, type ClipName } from './spec';

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface NormalizeCommand {
  input: string;
  output: string;
  anims: { name: ClipName; path: string }[];
  options: Omit<NormalizeOptions, 'extraClips'>;
}

const isClip = (name: string): name is ClipName => (CLIP_NAMES as readonly string[]).includes(name);
const clipList = CLIP_NAMES.join(', ');

function splitPair(raw: string, flag: string): [string, string] {
  const at = raw.indexOf('=');
  if (at < 1) throw new UsageError(`${flag} expects name=target, got "${raw}"`);
  return [raw.slice(0, at), raw.slice(at + 1)];
}

function toNumber(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new UsageError(`${flag} expects a number, got "${raw}"`);
  return n;
}

function parse(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      strict: true,
      options: {
        piece: { type: 'string' },
        in: { type: 'string' },
        out: { type: 'string' },
        keep: { type: 'string' },
        rename: { type: 'string', multiple: true },
        anim: { type: 'string', multiple: true },
        'rotate-y': { type: 'string' },
        'max-texture': { type: 'string' },
        'drop-base-clips': { type: 'boolean' },
      },
    }).values;
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
}

export function parseNormalizeArgs(argv: string[]): NormalizeCommand {
  const v = parse(argv);
  if (!v.piece) throw new UsageError('--piece is required');
  if (!v.in) throw new UsageError('--in is required');
  if (!v.out) throw new UsageError('--out is required');

  const keep = (v.keep ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => {
      if (!isClip(name)) throw new UsageError(`--keep: "${name}" is not one of ${clipList}`);
      return name;
    });

  const rename: Record<string, string | null> = {};
  for (const raw of v.rename ?? []) {
    const [from, to] = splitPair(raw, '--rename');
    rename[from] = to === '' ? null : to;
  }

  const anims = (v.anim ?? []).map((raw) => {
    const [name, path] = splitPair(raw, '--anim');
    if (!isClip(name)) throw new UsageError(`--anim: "${name}" is not one of ${clipList}`);
    if (path === '') throw new UsageError(`--anim expects clip=path.glb, got "${raw}"`);
    return { name, path };
  });

  return {
    input: v.in,
    output: v.out,
    anims,
    options: {
      piece: v.piece,
      keep,
      rename,
      rotateYDeg: toNumber(v['rotate-y'], '--rotate-y'),
      maxTexturePx: toNumber(v['max-texture'], '--max-texture'),
      dropBaseClips: v['drop-base-clips'],
    },
  };
}
