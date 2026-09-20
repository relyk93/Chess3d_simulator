import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { useActions } from '../controller/context';
import type { PlacedPiece } from '../controller/pieceTracker';
import { squareToWorld } from '../core/squares';
import type { PieceId } from '../core/types';
import { packUrl } from '../packs/loader';
import { usePacks } from '../packs/context';
import { pieceKey } from '../packs/types';
import type { PieceHandle } from '../sequencer/types';
import { applyLook } from './modelUtils';
import { gltfCache } from './assets';
import { PieceModel, type ModelApi } from './PieceModel';
import { PieceMotion } from './pieceMotion';
import { PlaceholderBody } from './PlaceholderPiece';
import { useSceneRegistry } from './sceneContext';

interface BodyProps {
  url: string;
  type: PlacedPiece['piece']['type'];
  sideColor: string;
  onApi: (api: ModelApi | null) => void;
}

/** The model if the set has one and it has loaded; the placeholder while loading, on failure, or when there is no file. */
export function PieceBody({ url, type, sideColor, onApi }: BodyProps) {
  const gltf = gltfCache.use(url);
  return gltf ? <PieceModel gltf={gltf} onApi={onApi} /> : <PlaceholderBody type={type} color={sideColor} />;
}

/**
 * One piece on the board. Its screen position comes from a PieceMotion the sequencer drives through the
 * registered handle, not from props. Props (the controller's truth) are adopted whenever the sequencer is
 * not holding the piece, and on `finish()`/`reset()`.
 */
export function PieceView({ id, placed }: { id: PieceId; placed: PlacedPiece }) {
  const registry = useSceneRegistry();
  const { set } = usePacks();
  const { clickSquare } = useActions();
  const color = placed.piece.color;

  const outer = useRef<Group>(null);
  const modelApi = useRef<ModelApi | null>(null);
  const truth = useRef(placed);
  truth.current = placed;
  const held = useRef(false);
  const [shownType, setShownType] = useState(placed.piece.type);

  const motion = useMemo(
    () => new PieceMotion(squareToWorld(placed.square), { x: 0, z: color === 'w' ? -1 : 1 }),
    // A piece's id fixes its color and starting square; later moves go through the handle.
    [id],
  );

  const handle = useMemo<PieceHandle>(() => {
    /** Snap to the controller's square and type, leaving a running fade or death in place. */
    const adoptPlace = () => {
      const t = truth.current;
      motion.snapTo(squareToWorld(t.square));
      setShownType(t.piece.type);
    };
    /** Snap to everything the controller says: square, type, and visible unless captured. */
    const adoptAll = () => {
      const t = truth.current;
      motion.reset(squareToWorld(t.square));
      if (t.captured) motion.fadeOut(0);
      modelApi.current?.stop();
      setShownType(t.piece.type);
    };
    return {
      play(clip) {
        if (!modelApi.current?.play(clip)) motion.playRigid(clip);
      },
      moveTo(to, ms) {
        motion.moveTo(typeof to === 'string' ? squareToWorld(to) : to, ms);
      },
      fadeOut: (ms) => motion.fadeOut(ms),
      pulse: (ms) => motion.pulse(ms),
      hold() {
        held.current = true;
      },
      finish() {
        motion.finish();
        modelApi.current?.stop();
        held.current = false;
        adoptPlace();
      },
      reset() {
        held.current = false;
        adoptAll();
      },
      snapshot() {
        const o = motion.output();
        return { x: o.x, z: o.z, visible: o.opacity > 0.001 && o.scale > 0.001 };
      },
    };
  }, [motion]);

  useEffect(() => registry.setPiece(id, handle), [registry, id, handle]);

  // Controller state changed (undo, new game, or a move nobody is animating): show it.
  useLayoutEffect(() => {
    if (!held.current) handle.reset();
  }, [handle, placed.square, placed.captured, placed.piece.type]);

  const onApi = useMemo(
    () => (api: ModelApi | null) => {
      modelApi.current = api;
      motion.bob = !api?.has('idle');
    },
    [motion],
  );

  useFrame((_, delta) => {
    const g = outer.current;
    if (!g) return;
    motion.update(delta * 1000);
    const o = motion.output();
    for (const ev of motion.takeEvents()) {
      if (ev === 'shatter') registry.handles.effects.burst({ x: o.x, y: 0.4, z: o.z }, 'sparks');
    }
    g.position.set(o.x, o.y, o.z);
    g.scale.setScalar(Math.max(o.scale, 1e-4));
    g.visible = o.opacity > 0.001 && o.scale > 0.001;
    applyLook(g, o);
  });

  const key = pieceKey(color, shownType);
  const url = packUrl(set.baseUrl, set.manifest.pieces[key]?.model ?? '');

  return (
    <group
      ref={outer}
      onClick={(e) => {
        e.stopPropagation();
        clickSquare(truth.current.square);
      }}
    >
      <group rotation={[0, color === 'b' ? Math.PI : 0, 0]}>
        <PieceBody key={`${key}@${url}`} url={url} type={shownType} sideColor={set.manifest.sides[color].color} onApi={onApi} />
      </group>
    </group>
  );
}
