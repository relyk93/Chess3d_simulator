import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { CameraHandle, CameraPose } from '../sequencer/types';
import { CameraMotion } from './cameraMotion';
import { useSceneRegistry } from './sceneContext';

export interface CameraRigHandle {
  reset(): void;
}

export const DEFAULT_CAMERA_POSITION: [number, number, number] = [0, 7, 7.5];

const HOME: CameraPose = {
  position: { x: DEFAULT_CAMERA_POSITION[0], y: DEFAULT_CAMERA_POSITION[1], z: DEFAULT_CAMERA_POSITION[2] },
  target: { x: 0, y: 0, z: 0 },
};

/**
 * Orbit controls for the player, plus a CameraHandle the sequencer uses to fly, shake, orbit and restore.
 * While a sequencer motion runs, OrbitControls is disabled and the CameraMotion owns the camera.
 */
export const CameraRig = forwardRef<CameraRigHandle>(function CameraRig(_, ref) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const registry = useSceneRegistry();
  const motion = useMemo(() => new CameraMotion(HOME), []);

  const handle = useMemo<CameraHandle>(() => {
    const read = (): CameraPose => {
      const t = controls.current?.target;
      return {
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: t?.x ?? 0, y: t?.y ?? 0, z: t?.z ?? 0 },
      };
    };
    /** Copy the motion's pose (plus shake) onto the real camera. Hands control back to the player once idle. */
    const write = () => {
      const c = controls.current;
      const { position: p, target: t } = motion.pose;
      const o = motion.shakeOffset;
      camera.position.set(p.x + o.x, p.y + o.y, p.z + o.z);
      c?.target.set(t.x, t.y, t.z);
      camera.lookAt(t.x, t.y, t.z);
      if (c) {
        c.enabled = !motion.busy;
        if (!motion.busy) c.update();
      }
    };
    const begin = () => motion.syncFrom(read());
    return {
      flyTo(pose, ms) { begin(); motion.flyTo(pose, ms); write(); },
      restore(ms) { motion.restore(ms); write(); },
      orbit(ms, turns) { begin(); motion.orbit(ms, turns); write(); },
      shake(ms, intensity) { motion.shake(ms, intensity); },
      finish() { motion.finish(); write(); },
      reset() {
        motion.reset();
        if (controls.current) controls.current.enabled = true;
      },
    };
  }, [camera, motion]);

  useEffect(() => registry.setCamera(handle), [registry, handle]);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    if (!motion.busy) {
      motion.syncFrom({
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: c.target.x, y: c.target.y, z: c.target.z },
      });
      return;
    }
    motion.update(delta * 1000);
    const { position: p, target: t } = motion.pose;
    const o = motion.shakeOffset;
    camera.position.set(p.x + o.x, p.y + o.y, p.z + o.z);
    c.target.set(t.x, t.y, t.z);
    camera.lookAt(t.x, t.y, t.z);
    if (!motion.busy) {
      c.enabled = true;
      c.update();
    }
  });

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
