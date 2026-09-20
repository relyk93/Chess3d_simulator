import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ALL_PIECE_KEYS, type SetManifest } from '../../src/packs/types';
import { parseSetManifest } from '../../src/packs/validate';
import { ART_GENERATOR } from './generator';
import { normalizeModel, type NormalizeReport } from './normalize';
import { NormalizeError, type ClipName } from './spec';

export interface PieceSource {
  /** The (rigged) glb, relative to the source folder. */
  model: string;
  rotateY?: number;
  /** Clips the manifest lists for this piece. Default `[]`, a rigid piece. */
  keep?: ClipName[];
  rename?: Record<string, string | null>;
  /** Remove the base model's own clips (a rig's walk and run) before `clips` are merged. */
  dropBaseClips?: boolean;
  /** Animation-only glb files to merge, by clip name, relative to the source folder. */
  clips?: Partial<Record<ClipName, string>>;
  maxTexture?: number;
}

export interface SetSource {
  id: string;
  name: string;
  version: number;
  sides: SetManifest['sides'];
  /** Sound name to file, relative to the source folder. Copied into `audio/`. */
  audio?: Record<string, string>;
  pieces: Record<string, PieceSource>;
}

const bytesOf = (path: string) => new Uint8Array(readFileSync(path));

function put(path: string, data: Uint8Array | string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

/** The manifest is written last, so a failed build never leaves one pointing at missing files. */
export async function buildSet(srcDir: string, outDir: string): Promise<NormalizeReport[]> {
  const source = JSON.parse(readFileSync(join(srcDir, 'set.json'), 'utf8')) as SetSource;

  const missing = ALL_PIECE_KEYS.filter((k) => !Object.hasOwn(source.pieces, k));
  const unknown = Object.keys(source.pieces).filter((k) => !ALL_PIECE_KEYS.includes(k));
  if (missing.length > 0) throw new NormalizeError('set.json', `missing pieces: ${missing.join(', ')}`);
  if (unknown.length > 0) throw new NormalizeError('set.json', `unknown pieces: ${unknown.join(', ')}`);

  const reports: NormalizeReport[] = [];
  const pieces: SetManifest['pieces'] = {};
  for (const key of ALL_PIECE_KEYS) {
    const piece = source.pieces[key]!;
    const extraClips = Object.entries(piece.clips ?? {}).flatMap(([name, path]) =>
      path ? [{ name, bytes: bytesOf(join(srcDir, path)) }] : [],
    );
    const { glb, report } = await normalizeModel(bytesOf(join(srcDir, piece.model)), {
      piece: key,
      keep: piece.keep ?? [],
      rename: piece.rename,
      dropBaseClips: piece.dropBaseClips,
      rotateYDeg: piece.rotateY,
      maxTexturePx: piece.maxTexture,
      extraClips,
    });
    put(join(outDir, 'models', `${key}.glb`), glb);
    pieces[key] = { model: `models/${key}.glb`, clips: report.clips };
    reports.push(report);
  }

  const audio: Record<string, string> = {};
  for (const [sound, path] of Object.entries(source.audio ?? {})) {
    const file = `audio/${basename(path)}`;
    mkdirSync(join(outDir, 'audio'), { recursive: true });
    copyFileSync(join(srcDir, path), join(outDir, file));
    audio[sound] = file;
  }

  const manifest = {
    id: source.id,
    name: source.name,
    version: source.version,
    sides: source.sides,
    pieces,
    audio,
    sequenceOverride: null,
    generator: ART_GENERATOR,
  };
  parseSetManifest(manifest);
  put(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return reports;
}
