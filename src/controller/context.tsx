import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { ControllerActions, ControllerState, ControllerStore } from './store';

const Ctx = createContext<ControllerStore | null>(null);

export function ControllerProvider({ store, children }: { store: ControllerStore; children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useControllerStore(): ControllerStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('useController must be used inside <ControllerProvider>');
  return store;
}

export function useController<T>(selector: (s: ControllerState & { actions: ControllerActions }) => T): T {
  return useStore(useControllerStore(), selector);
}

export function useActions(): ControllerActions {
  return useController((s) => s.actions);
}
