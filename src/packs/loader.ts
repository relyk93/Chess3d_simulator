import { FALLBACK_BOARD, FALLBACK_SET } from './fallback';
import type { BoardPack, SetPack } from './types';
import { parseBoardManifest, parseSetManifest } from './validate';

export const PACKS_ROOT = '/packs';
/** Version A ships one set and one board, chosen here. Version B makes this user-selectable. */
export const ACTIVE_SET_ID = 'angels-vs-demons';
export const ACTIVE_BOARD_ID = 'stone-lava';

export type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Resolves a manifest-relative path against the pack's base URL. An empty path stays empty (no file). */
export function packUrl(baseUrl: string, path: string): string {
  return path === '' ? '' : `${baseUrl}/${path.replace(/^\.?\//, '')}`;
}

async function fetchManifest(fetchFn: Fetch, baseUrl: string): Promise<unknown> {
  const res = await fetchFn(`${baseUrl}/manifest.json`);
  if (!res.ok) throw new Error(`${baseUrl}/manifest.json returned HTTP ${res.status}`);
  return res.json();
}

export async function loadSetPack(id: string, fetchFn: Fetch = (u) => fetch(u)): Promise<SetPack> {
  const baseUrl = `${PACKS_ROOT}/sets/${id}`;
  return { baseUrl, manifest: parseSetManifest(await fetchManifest(fetchFn, baseUrl)) };
}

export async function loadBoardPack(id: string, fetchFn: Fetch = (u) => fetch(u)): Promise<BoardPack> {
  const baseUrl = `${PACKS_ROOT}/boards/${id}`;
  return { baseUrl, manifest: parseBoardManifest(await fetchManifest(fetchFn, baseUrl)) };
}

/** Never rejects: a pack that fails to load is logged once and replaced by the built-in fallback. */
export async function loadActivePacks(fetchFn?: Fetch): Promise<{ set: SetPack; board: BoardPack }> {
  const [set, board] = await Promise.all([
    loadSetPack(ACTIVE_SET_ID, fetchFn).catch((e: unknown) => {
      console.warn('Set pack failed to load, using placeholders', e);
      return FALLBACK_SET;
    }),
    loadBoardPack(ACTIVE_BOARD_ID, fetchFn).catch((e: unknown) => {
      console.warn('Board pack failed to load, using the default board', e);
      return FALLBACK_BOARD;
    }),
  ]);
  return { set, board };
}
