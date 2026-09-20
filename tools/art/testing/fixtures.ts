import sharp from 'sharp';
import { Document, type Accessor } from '@gltf-transform/core';
import { io } from '../io';

export interface StatueOptions {
  /** Box extents [x, y, z]. Default [0.4, 2, 0.4]. */
  size?: [number, number, number];
  /** Box center. Default [0, 1, 0], so the base sits on y = 0. */
  center?: [number, number, number];
  /** Bind the box to a two-joint skeleton: `root` at the origin and `tip` one unit up. */
  skinned?: boolean;
  /** Clips to author. A name ending in "idle" loops; the others are two-key moves. */
  clips?: string[];
  /** Make an idle clip end on a different value than it starts on. */
  openIdle?: boolean;
  /** Attach a non-solid base color texture of this many pixels square. */
  texturePx?: number;
}

const CORNERS = [
  [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1],
  [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1],
] as const;
const TRIANGLES = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7];

/** A gradient, because `prune()` folds a solid-color texture into a material factor and removes it. */
function gradient(n: number): Buffer {
  const b = Buffer.alloc(n * n * 3);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 3;
      b[i] = (x * 255) / n;
      b[i + 1] = (y * 255) / n;
      b[i + 2] = (x ^ y) & 255;
    }
  }
  return b;
}

export async function statueDoc(opts: StatueOptions = {}): Promise<Document> {
  const { size = [0.4, 2, 0.4], center = [0, 1, 0], skinned = false, clips = [], openIdle = false, texturePx } = opts;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const accessor = (type: Parameters<Accessor['setType']>[0], array: Float32Array | Uint16Array) =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);

  const positions = new Float32Array(
    CORNERS.flatMap(([cx, cy, cz]) => [
      center[0] + (cx * size[0]) / 2,
      center[1] + (cy * size[1]) / 2,
      center[2] + (cz * size[2]) / 2,
    ]),
  );
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', positions))
    .setIndices(accessor('SCALAR', new Uint16Array(TRIANGLES)));

  if (texturePx) {
    const jpeg = await sharp(gradient(texturePx), { raw: { width: texturePx, height: texturePx, channels: 3 } }).jpeg().toBuffer();
    const texture = doc.createTexture('base').setMimeType('image/jpeg').setImage(new Uint8Array(jpeg));
    prim.setMaterial(doc.createMaterial('paint').setBaseColorTexture(texture));
    prim.setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1])));
  }

  const scene = doc.createScene('scene');
  const body = doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(prim));
  let animated = body;

  if (skinned) {
    const joints = new Uint16Array(32);
    const weights = new Float32Array(32);
    CORNERS.forEach(([, cy], v) => {
      joints[v * 4] = cy > 0 ? 1 : 0;
      weights[v * 4] = 1;
    });
    prim.setAttribute('JOINTS_0', accessor('VEC4', joints)).setAttribute('WEIGHTS_0', accessor('VEC4', weights));
    const root = doc.createNode('root');
    const tip = doc.createNode('tip').setTranslation([0, 1, 0]);
    root.addChild(tip);
    const inverseBind = new Float32Array(32);
    inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
    inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1], 16);
    body.setSkin(
      doc.createSkin('skin').addJoint(root).addJoint(tip).setSkeleton(root).setInverseBindMatrices(accessor('MAT4', inverseBind)),
    );
    scene.addChild(root);
    animated = tip;
  }
  scene.addChild(body);

  for (const name of clips) {
    const base = animated.getTranslation();
    const lift = (dy: number): number[] => [base[0], base[1] + dy, base[2]];
    const loops = /idle$/i.test(name);
    const times = loops ? [0, 0.5, 1] : [0, 1];
    const values = loops ? [...lift(0), ...lift(0.1), ...lift(openIdle ? 0.05 : 0)] : [...lift(0), ...lift(0.1)];
    const sampler = doc
      .createAnimationSampler()
      .setInput(accessor('SCALAR', new Float32Array(times)))
      .setOutput(accessor('VEC3', new Float32Array(values)))
      .setInterpolation('LINEAR');
    const channel = doc.createAnimationChannel().setTargetNode(animated).setTargetPath('translation').setSampler(sampler);
    doc.createAnimation(name).addSampler(sampler).addChannel(channel);
  }
  return doc;
}

export async function statueGlb(opts: StatueOptions = {}): Promise<Uint8Array> {
  return io.writeBinary(await statueDoc(opts));
}

export function readGlb(bytes: Uint8Array): Promise<Document> {
  return io.readBinary(bytes);
}
