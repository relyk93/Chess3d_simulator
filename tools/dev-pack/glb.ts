export interface MeshData {
  name: string;
  positions: number[];
  normals: number[];
  uvs?: number[];
  indices: number[];
  material: { color: [number, number, number, number]; metallic: number; roughness: number };
}

export interface ClipData {
  name: string;
  /** Name of the mesh node this clip animates. */
  node: string;
  times: number[];
  /** Flattened quaternions (x y z w), one per time. */
  rotations?: number[];
  /** Flattened translations (x y z), one per time. */
  translations?: number[];
}

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

interface Accessor {
  bufferView: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC3' | 'VEC2' | 'VEC4';
  min?: number[];
  max?: number[];
}

function pad4(n: number): number {
  return (n + 3) & ~3;
}

function bounds(values: number[], stride: number): { min: number[]; max: number[] } {
  const min = new Array<number>(stride).fill(Infinity);
  const max = new Array<number>(stride).fill(-Infinity);
  for (let i = 0; i < values.length; i += stride) {
    for (let k = 0; k < stride; k++) {
      const v = values[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}

/** Builds a binary glTF 2.0 file: one node per mesh, optional node-transform animation clips. */
export function buildGlb(meshes: MeshData[], clips: ClipData[] = []): Uint8Array {
  const chunks: Uint8Array[] = [];
  const bufferViews: { buffer: 0; byteOffset: number; byteLength: number; target?: number }[] = [];
  const accessors: Accessor[] = [];
  let offset = 0;

  function addData(bytes: Uint8Array, target?: number): number {
    const padded = new Uint8Array(pad4(bytes.byteLength));
    padded.set(bytes);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(padded);
    offset += padded.byteLength;
    return bufferViews.length - 1;
  }

  function addFloats(values: number[], type: Accessor['type'], stride: number, target?: number, withBounds = false): number {
    const view = addData(new Uint8Array(new Float32Array(values).buffer), target);
    accessors.push({
      bufferView: view,
      componentType: FLOAT,
      count: values.length / stride,
      type,
      ...(withBounds ? bounds(values, stride) : {}),
    });
    return accessors.length - 1;
  }

  function addIndices(values: number[]): number {
    const useShort = Math.max(...values) < 65536;
    const data = useShort ? new Uint16Array(values) : new Uint32Array(values);
    const view = addData(new Uint8Array(data.buffer), ELEMENT_ARRAY_BUFFER);
    accessors.push({ bufferView: view, componentType: useShort ? UNSIGNED_SHORT : UNSIGNED_INT, count: values.length, type: 'SCALAR' });
    return accessors.length - 1;
  }

  const nodeIndex = new Map<string, number>();
  const gltfMeshes = meshes.map((m, i) => {
    nodeIndex.set(m.name, i);
    const attributes: Record<string, number> = {
      POSITION: addFloats(m.positions, 'VEC3', 3, ARRAY_BUFFER, true),
      NORMAL: addFloats(m.normals, 'VEC3', 3, ARRAY_BUFFER),
    };
    if (m.uvs) attributes.TEXCOORD_0 = addFloats(m.uvs, 'VEC2', 2, ARRAY_BUFFER);
    return { name: m.name, primitives: [{ attributes, indices: addIndices(m.indices), material: i }] };
  });

  const animations = clips.map((clip) => {
    const node = nodeIndex.get(clip.node);
    if (node === undefined) throw new Error(`Clip ${clip.name} targets unknown node ${clip.node}`);
    const input = addFloats(clip.times, 'SCALAR', 1, undefined, true);
    const samplers: { input: number; output: number; interpolation: 'LINEAR' }[] = [];
    const channels: { sampler: number; target: { node: number; path: string } }[] = [];
    if (clip.rotations) {
      samplers.push({ input, output: addFloats(clip.rotations, 'VEC4', 4), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node, path: 'rotation' } });
    }
    if (clip.translations) {
      samplers.push({ input, output: addFloats(clip.translations, 'VEC3', 3), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node, path: 'translation' } });
    }
    return { name: clip.name, samplers, channels };
  });

  const json = {
    asset: { version: '2.0', generator: 'chess3d dev-pack' },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, i) => i) }],
    nodes: meshes.map((m, i) => ({ name: m.name, mesh: i })),
    meshes: gltfMeshes,
    materials: meshes.map((m) => ({
      name: `${m.name}-mat`,
      pbrMetallicRoughness: { baseColorFactor: m.material.color, metallicFactor: m.material.metallic, roughnessFactor: m.material.roughness },
    })),
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
    ...(animations.length ? { animations } : {}),
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(pad4(jsonBytes.byteLength)).fill(0x20);
  jsonPadded.set(jsonBytes);
  const bin = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) {
    bin.set(c, at);
    at += c.byteLength;
  }

  const total = 12 + 8 + jsonPadded.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonPadded.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonPadded, 20);
  const binHeader = 20 + jsonPadded.byteLength;
  dv.setUint32(binHeader, bin.byteLength, true);
  dv.setUint32(binHeader + 4, 0x004e4942, true); // 'BIN\0'
  out.set(bin, binHeader + 8);
  return out;
}
