import type { Document } from '@gltf-transform/core';
import { applyClips } from './clips';
import { assertNotFarOff, assertYUp, measure, theScene } from './inspect';
import { io } from './io';
import { mergeClips, type ClipSource } from './mergeClips';
import { DEFAULT_TEXTURE_PX, NormalizeError, pieceHeight, type ClipName } from './spec';
import { assertSize, slim } from './textures';
import { normalizeTransform } from './transform';

export interface NormalizeOptions {
  /** Manifest key, for example `w-king`. */
  piece: string;
  /** Clips the manifest will list for this piece. Empty for a rigid piece. */
  keep: readonly ClipName[];
  /** Source clip name to standard name, or `null` to delete the clip. */
  rename?: Record<string, string | null>;
  /** Turn the model about Y first, for exports that do not face +Z. */
  rotateYDeg?: number;
  /** Texture size ceiling in pixels, up to 2048. Default 1024. */
  maxTexturePx?: number;
  /** Animation-only files (for example Meshy Animation API output); each `name` becomes a clip. */
  extraClips?: readonly { name: string; bytes: Uint8Array }[];
}

export interface NormalizeReport {
  piece: string;
  heightUnits: number;
  bytes: number;
  clips: ClipName[];
  warnings: string[];
}

export interface NormalizeResult {
  glb: Uint8Array;
  report: NormalizeReport;
}

async function read(bytes: Uint8Array, piece: string, what: string): Promise<Document> {
  try {
    return await io.readBinary(bytes);
  } catch (e) {
    throw new NormalizeError(piece, `${what} is not a readable glb: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function normalizeModel(input: Uint8Array, opts: NormalizeOptions): Promise<NormalizeResult> {
  const { piece } = opts;
  const targetHeight = pieceHeight(piece);
  const doc = await read(input, piece, 'the model');
  const scene = theScene(doc, piece);

  const before = measure(scene, piece);
  assertYUp(before, piece);
  assertNotFarOff(before, piece);

  const warnings: string[] = [];
  if (opts.extraClips && opts.extraClips.length > 0) {
    const sources: ClipSource[] = [];
    for (const clip of opts.extraClips) {
      sources.push({ name: clip.name, doc: await read(clip.bytes, piece, `the animation file for "${clip.name}"`) });
    }
    warnings.push(...mergeClips(doc, piece, sources));
  }

  const clipReport = applyClips(doc, piece, { rename: opts.rename ?? {}, keep: opts.keep });
  warnings.push(...clipReport.warnings);

  normalizeTransform(doc, scene, piece, { targetHeight, rotateYDeg: opts.rotateYDeg });
  await slim(doc, piece, opts.maxTexturePx ?? DEFAULT_TEXTURE_PX);

  const glb = await io.writeBinary(doc);
  assertSize(piece, glb.byteLength);

  return {
    glb,
    report: { piece, heightUnits: measure(scene, piece).size[1], bytes: glb.byteLength, clips: clipReport.clips, warnings },
  };
}
