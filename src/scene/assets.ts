import { useEffect, useState } from 'react';
import type { DataTexture } from 'three';
import { EquirectangularReflectionMapping } from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

type Entry<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed' };

export interface AssetCache<T> {
  /**
   * Returns the loaded asset, or null while it loads, if `url` is empty, or if it failed. Starts the load on first use.
   * Failures are logged once per URL and never thrown, so a missing file can never take the scene down.
   */
  use(url: string): T | null;
  /** Non-React lookup, mainly for tests. */
  peek(url: string): T | null;
}

/** One shared load per URL, however many components ask for it. */
export function createAssetCache<T>(load: (url: string) => Promise<T>): AssetCache<T> {
  const entries = new Map<string, Entry<T>>();
  const waiting = new Map<string, Set<() => void>>();

  function start(url: string): void {
    if (entries.has(url)) return;
    entries.set(url, { state: 'loading' });
    load(url)
      .then(
        (value) => entries.set(url, { state: 'ready', value }),
        (error: unknown) => {
          entries.set(url, { state: 'failed' });
          console.warn(`Asset ${url} failed to load; using a fallback`, error);
        },
      )
      .finally(() => waiting.get(url)?.forEach((notify) => notify()));
  }

  const peek = (url: string): T | null => {
    const e = url ? entries.get(url) : undefined;
    return e?.state === 'ready' ? e.value : null;
  };

  return {
    peek,
    use(url) {
      const [, bump] = useState(0);
      useEffect(() => {
        if (!url) return;
        start(url);
        const notify = () => bump((n) => n + 1);
        let set = waiting.get(url);
        if (!set) waiting.set(url, (set = new Set()));
        set.add(notify);
        // The asset may have finished between render and this effect.
        if (entries.get(url)?.state !== 'loading') notify();
        return () => { set.delete(notify); };
      }, [url]);
      return peek(url);
    },
  };
}

const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
const gltfLoader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);

export const gltfCache = createAssetCache<GLTF>((url) => gltfLoader.loadAsync(url));

export const hdrCache = createAssetCache<DataTexture>(async (url) => {
  const texture = await new HDRLoader().loadAsync(url);
  texture.mapping = EquirectangularReflectionMapping;
  return texture;
});
