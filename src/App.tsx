import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { getAppStore } from './appStore';
import { ControllerProvider } from './controller/context';
import { PacksProvider } from './packs/context';
import { createSceneRegistry } from './scene/registry';
import { SceneRegistryProvider } from './scene/sceneContext';
import { Scene } from './scene/Scene';
import { startAnimationBridge } from './scene/animationBridge';
import type { CameraRigHandle } from './scene/CameraRig';
import { Overlay } from './ui/Overlay';
import { DEFAULT_CAMERA_POSITION } from './scene/CameraRig';

export function App() {
  const store = getAppStore();
  const registry = useMemo(() => createSceneRegistry(), []);
  const cameraRef = useRef<CameraRigHandle>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => startAnimationBridge(store), [store]);

  return (
    <ControllerProvider store={store}>
      <PacksProvider>
        <SceneRegistryProvider value={registry}>
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
