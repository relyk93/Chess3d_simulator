import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AnimationMixer, LoopOnce, LoopRepeat, type AnimationAction } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ClipName } from '../sequencer/types';
import { disposeModelMaterials, prepareModel } from './modelUtils';

/** What PieceView needs from a loaded model: which clips it really has, and a way to play them. */
export interface ModelApi {
  has(clip: ClipName): boolean;
  /** Returns false if the model has no such clip, so the caller can use the rigid fallback. */
  play(clip: ClipName): boolean;
  /** Stops any one-shot clip and returns to `idle` if the model has one. */
  stop(): void;
}

export function PieceModel({ gltf, onApi }: { gltf: GLTF; onApi: (api: ModelApi | null) => void }) {
  const root = useMemo(() => prepareModel(gltf.scene), [gltf.scene]);
  const mixer = useMemo(() => new AnimationMixer(root), [root]);

  useEffect(() => {
    const action = (clip: ClipName): AnimationAction | null => {
      const c = gltf.animations.find((a) => a.name === clip);
      return c ? mixer.clipAction(c) : null;
    };
    const startIdle = () => {
      const idle = action('idle');
      if (idle) idle.reset().setLoop(LoopRepeat, Infinity).play();
    };
    const api: ModelApi = {
      has: (clip) => gltf.animations.some((a) => a.name === clip),
      play(clip) {
        const a = action(clip);
        if (!a) return false;
        if (clip === 'idle') {
          startIdle();
          return true;
        }
        a.reset().setLoop(LoopOnce, 1);
        a.clampWhenFinished = clip === 'die';
        a.play();
        return true;
      },
      stop() {
        mixer.stopAllAction();
        startIdle();
      },
    };
    const onFinished = (e: { action: AnimationAction }) => {
      // After a one-shot (except `die`, which holds its last pose) settle back into idle.
      if (e.action.getClip().name !== 'die') {
        e.action.stop();
        startIdle();
      }
    };
    mixer.addEventListener('finished', onFinished as never);
    startIdle();
    onApi(api);
    return () => {
      mixer.removeEventListener('finished', onFinished as never);
      mixer.stopAllAction();
      onApi(null);
    };
  }, [gltf, mixer, onApi]);

  useEffect(() => () => disposeModelMaterials(root), [root]);

  useFrame((_, delta) => mixer.update(delta));

  return <primitive object={root} />;
}
