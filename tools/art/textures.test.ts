// @vitest-environment node
import sharp from 'sharp';
import { assertSize, slim } from './textures';
import { statueDoc } from './testing/fixtures';

const firstTexture = async (doc: Awaited<ReturnType<typeof statueDoc>>) => {
  const texture = doc.getRoot().listTextures()[0]!;
  return { meta: await sharp(texture.getImage()!).metadata(), mime: texture.getMimeType() };
};

describe('slim', () => {
  test('shrinks an oversize texture and re-encodes it as JPEG', async () => {
    const doc = await statueDoc({ texturePx: 2048 });
    await slim(doc, 'w-king', 1024);
    const { meta, mime } = await firstTexture(doc);
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(1024);
    expect(mime).toBe('image/jpeg');
  });

  test('does not enlarge a smaller texture', async () => {
    const doc = await statueDoc({ texturePx: 512 });
    await slim(doc, 'w-king', 1024);
    expect((await firstTexture(doc)).meta.width).toBe(512);
  });

  test('accepts the spec ceiling of 2048', async () => {
    const doc = await statueDoc({ texturePx: 256 });
    await expect(slim(doc, 'w-king', 2048)).resolves.toBeUndefined();
  });

  test.each([4096, 8, 1000.5])('rejects a max texture size of %s', async (px) => {
    const doc = await statueDoc({ texturePx: 256 });
    await expect(slim(doc, 'w-king', px)).rejects.toThrow(/w-king: max texture size must be a whole number from 16 to 2048/);
  });

  test('a model without textures passes through', async () => {
    const doc = await statueDoc();
    await expect(slim(doc, 'w-king', 1024)).resolves.toBeUndefined();
    expect(doc.getRoot().listMeshes()).toHaveLength(1);
  });
});

describe('assertSize', () => {
  test('accepts a file just under 2 MB', () => {
    expect(() => assertSize('w-king', 2 * 1024 * 1024 - 1)).not.toThrow();
  });

  test('rejects a file at 2 MB with the size and a fix', () => {
    expect(() => assertSize('w-king', 2 * 1024 * 1024)).toThrow(
      /w-king: 2\.00 MB is over the 2 MB limit\. Lower --max-texture or regenerate with a lower target_polycount\./,
    );
  });
});
