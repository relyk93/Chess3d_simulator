import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { FALLBACK_BOARD, FALLBACK_SET } from './fallback';
import { loadActivePacks } from './loader';
import type { BoardPack, SetPack } from './types';

export interface LoadedPacks {
  set: SetPack;
  board: BoardPack;
}

const Ctx = createContext<LoadedPacks>({ set: FALLBACK_SET, board: FALLBACK_BOARD });

/**
 * Starts with the built-in fallback packs so the board and placeholder pieces render immediately, then swaps in the
 * real packs when their manifests arrive (spec section 12: packs stream in after the board is visible).
 */
export function PacksProvider({ children }: { children: ReactNode }) {
  const [packs, setPacks] = useState<LoadedPacks>({ set: FALLBACK_SET, board: FALLBACK_BOARD });
  useEffect(() => {
    let cancelled = false;
    void loadActivePacks().then((p) => { if (!cancelled) setPacks(p); });
    return () => { cancelled = true; };
  }, []);
  return <Ctx.Provider value={packs}>{children}</Ctx.Provider>;
}

export function usePacks(): LoadedPacks {
  return useContext(Ctx);
}
