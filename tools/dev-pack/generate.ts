import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ART_GENERATOR } from '../art/generator';
import { attackSound, dieSound, hitSound } from './audio';
import { buildBoardGlb } from './board';
import { buildEnvHdr } from './hdr';
import { buildPieceGlb, PIECE_NAMES, RIGGED, SIDE_HEX, type Color, type PieceType } from './pieces';

const COLORS: Color[] = ['w', 'b'];
const TYPES: PieceType[] = ['k', 'q', 'r', 'b', 'n', 'p'];
const CLIPS = ['idle', 'attack', 'hit', 'die', 'victory'];

export function setManifest() {
  const pieces: Record<string, { model: string; clips: string[] }> = {};
  for (const c of COLORS) {
    for (const t of TYPES) {
      const key = `${c}-${PIECE_NAMES[t]}`;
      pieces[key] = { model: `models/${key}.glb`, clips: RIGGED.includes(t) ? CLIPS : [] };
    }
  }
  return {
    id: 'angels-vs-demons',
    name: 'Angels vs Demons',
    version: 1,
    sides: {
      w: { name: 'Angels', color: SIDE_HEX.w, impactEffect: 'light' },
      b: { name: 'Demons', color: SIDE_HEX.b, impactEffect: 'fire' },
    },
    pieces,
    audio: { attack: 'audio/attack.wav', hit: 'audio/hit.wav', die: 'audio/die.wav' },
    sequenceOverride: null,
  };
}

export function boardManifest() {
  return {
    id: 'stone-lava',
    name: 'Stone and Lava',
    version: 1,
    model: 'board.glb',
    environment: 'env.hdr',
    squares: { light: '#8c8378', dark: '#3b3733', highlight: '#ffd66b', capture: '#ff5a3c' },
    ambient: { type: 'lava-cracks', intensity: 0.6 },
  };
}

function write(path: string, data: Uint8Array | string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

function refuseToOverwriteArtPack(manifestPath: string) {
  if (!existsSync(manifestPath)) return;
  const { generator } = JSON.parse(readFileSync(manifestPath, 'utf8')) as { generator?: unknown };
  if (generator === ART_GENERATOR) {
    throw new Error(
      `refusing to overwrite the art-pipeline pack at ${manifestPath}; delete that pack's folder first if you want the dev pack back`,
    );
  }
}

export function generateDevPacks(publicDir: string): string[] {
  refuseToOverwriteArtPack(join(publicDir, 'packs/sets/angels-vs-demons/manifest.json'));
  refuseToOverwriteArtPack(join(publicDir, 'packs/boards/stone-lava/manifest.json'));
  const written: string[] = [];
  const put = (rel: string, data: Uint8Array | string) => {
    write(join(publicDir, rel), data);
    written.push(rel);
  };
  const set = 'packs/sets/angels-vs-demons';
  for (const c of COLORS) for (const t of TYPES) put(`${set}/models/${c}-${PIECE_NAMES[t]}.glb`, buildPieceGlb(c, t));
  put(`${set}/audio/attack.wav`, attackSound());
  put(`${set}/audio/hit.wav`, hitSound());
  put(`${set}/audio/die.wav`, dieSound());
  put(`${set}/manifest.json`, JSON.stringify(setManifest(), null, 2) + '\n');
  const board = 'packs/boards/stone-lava';
  put(`${board}/board.glb`, buildBoardGlb());
  put(`${board}/env.hdr`, buildEnvHdr());
  put(`${board}/manifest.json`, JSON.stringify(boardManifest(), null, 2) + '\n');
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
  const files = generateDevPacks(root);
  console.log(`[dev-pack] wrote ${files.length} files under public/packs`);
}
