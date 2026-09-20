import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { createAudioEngine } from './audio/audioEngine';
import { getAppStore } from './appStore';
import { ControllerProvider } from './controller/context';
import type { ControllerStore } from './controller/store';
import { PacksProvider, usePacks } from './packs/context';
import { packUrl } from './packs/loader';
import { createSceneRegistry, type SceneRegistry } from './scene/registry';
import { DEFAULT_CAMERA_POSITION, type CameraRigHandle } from './scene/CameraRig';
import { SceneRegistryProvider } from './scene/sceneContext';
import { Scene } from './scene/Scene';
import { startSequenceDriver } from './sequencer/driver';
import { Overlay } from './ui/Overlay';

declare global {
  interface Window {
    __chess3dScene?: SceneRegistry;
  }
}

/** Non-visual: connects the controller to the scene (sequence driver) and the active set's sounds. */
function Runtime({ store, registry }: { store: ControllerStore; registry: SceneRegistry }) {
  const { set } = usePacks();
  const setRef = useRef(set);
  setRef.current = set;

  useEffect(
    () => startSequenceDriver({ store, handles: registry.handles, impactEffect: (side) => setRef.current.manifest.sides[side].impactEffect }),
    [store, registry],
  );

  useEffect(() => {
    const urls = Object.fromEntries(Object.entries(set.manifest.audio).map(([name, path]) => [name, packUrl(set.baseUrl, path)]));
    const engine = createAudioEngine({ urls, isEnabled: () => store.getState().settings.sound });
    const off = registry.setAudio(engine);
    return () => {
      off();
      engine.dispose();
    };
  }, [set, store, registry]);

  useEffect(() => {
    if (import.meta.env.DEV) window.__chess3dScene = registry;
  }, [registry]);

  return null;
}

export function App() {
  const store = getAppStore();
  const registry = useMemo(() => createSceneRegistry(), []);
  const cameraRef = useRef<CameraRigHandle>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  return (
    <ControllerProvider store={store}>
      <PacksProvider>
        <SceneRegistryProvider value={registry}>
          <Runtime store={store} registry={registry} />
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <Canvas
              shadows="percentage"
              camera={{ position: DEFAULT_CAMERA_POSITION, fov: 45 }}
              dpr={[1, 2]}
              onCreated={({ gl }) => {
                const el = gl.domElement;
                el.addEventListener('webglcontextlost', (e) => {
                  e.preventDefault(); // allows the browser to restore the context
                  setContextLost(true);
                });
                el.addEventListener('webglcontextrestored', () => setContextLost(false));
                setCanvasReady(true);
              }}
            >
              <Scene cameraRef={cameraRef} />
            </Canvas>
            <Overlay
              onResetView={() => cameraRef.current?.reset()}
              scenePromotion={canvasReady && !contextLost}
              contextLost={contextLost}
            />
          </div>
        </SceneRegistryProvider>
      </PacksProvider>
    </ControllerProvider>
  );
}
