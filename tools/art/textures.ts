import sharp from 'sharp';
import type { Document } from '@gltf-transform/core';
import { dedup, prune, textureCompress } from '@gltf-transform/functions';
import { MAX_MODEL_BYTES, MAX_TEXTURE_PX, NormalizeError } from './spec';

/** Drops unused data and re-encodes textures as JPEG no larger than `maxTexturePx`. Alpha is not kept. */
export async function slim(doc: Document, piece: string, maxTexturePx: number): Promise<void> {
  if (!Number.isInteger(maxTexturePx) || maxTexturePx < 16 || maxTexturePx > MAX_TEXTURE_PX) {
    throw new NormalizeError(piece, `max texture size must be a whole number from 16 to ${MAX_TEXTURE_PX}, got ${maxTexturePx}`);
  }
  await doc.transform(
    prune(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [maxTexturePx, maxTexturePx], quality: 85 }),
  );
}

export function assertSize(piece: string, bytes: number): void {
  if (bytes >= MAX_MODEL_BYTES) {
    throw new NormalizeError(
      piece,
      `${(bytes / 1024 / 1024).toFixed(2)} MB is over the 2 MB limit. Lower --max-texture or regenerate with a lower target_polycount.`,
    );
  }
}
