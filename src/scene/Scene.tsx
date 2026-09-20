import type { RefObject } from 'react';
import { Board } from './Board';
import { Pieces } from './Pieces';
import { CameraRig, type CameraRigHandle } from './CameraRig';
import { Effects } from './Effects';

export function Scene({ cameraRef }: { cameraRef: RefObject<CameraRigHandle | null> }) {
  return (
    <>
      <color attach="background" args={['#0b0b0e']} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[4, 10, 6]}
        intensity={1.6}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <spotLight position={[0, 12, 0]} angle={0.5} penumbra={0.6} intensity={30} castShadow />
      <Board />
      <Pieces />
      <CameraRig ref={cameraRef} />
      <Effects />
    </>
  );
}
