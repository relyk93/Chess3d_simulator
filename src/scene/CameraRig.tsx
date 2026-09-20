import { forwardRef, useImperativeHandle, useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useThree } from '@react-three/fiber';

export interface CameraRigHandle {
  reset(): void;
}

export const DEFAULT_CAMERA_POSITION: [number, number, number] = [0, 7, 7.5];

export const CameraRig = forwardRef<CameraRigHandle>(function CameraRig(_, ref) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);

  useImperativeHandle(ref, () => ({
    reset() {
      camera.position.set(...DEFAULT_CAMERA_POSITION);
      controls.current?.target.set(0, 0, 0);
      controls.current?.update();
    },
  }));

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      minDistance={5}
      maxDistance={16}
      maxPolarAngle={Math.PI / 2.3}
      target={[0, 0, 0]}
    />
  );
});
