import { createContext, useContext } from 'react';
import type { SceneRegistry } from './registry';

const Ctx = createContext<SceneRegistry | null>(null);
export const SceneRegistryProvider = Ctx.Provider;

export function useSceneRegistry(): SceneRegistry {
  const r = useContext(Ctx);
  if (!r) throw new Error('useSceneRegistry must be used inside <SceneRegistryProvider>');
  return r;
}
