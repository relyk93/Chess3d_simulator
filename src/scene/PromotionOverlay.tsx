import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { useActions, useController } from '../controller/context';
import type { Color, PromotionPiece } from '../core/types';
import { usePacks } from '../packs/context';
import { packUrl } from '../packs/loader';
import { pieceKey } from '../packs/types';
import { useEscapeToCancel } from '../ui/useEscapeToCancel';
import { PieceBody } from './PieceView';

const CHOICES: PromotionPiece[] = ['q', 'r', 'b', 'n'];
const noop = () => {};

function Choice({ type, color, x, onPick }: { type: PromotionPiece; color: Color; x: number; onPick: () => void }) {
  const { set } = usePacks();
  const spin = useRef<Group>(null);
  const [hover, setHover] = useState(false);
  useFrame((_, delta) => {
    if (spin.current) spin.current.rotation.y += delta * (hover ? 2.4 : 0.8);
  });
  const key = pieceKey(color, type);
  return (
    <group
      position={[x, 0, 0]}
      scale={hover ? 1.4 : 1.1}
      onClick={(e) => { e.stopPropagation(); onPick(); }}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}
    >
      <group ref={spin}>
        <PieceBody url={packUrl(set.baseUrl, set.manifest.pieces[key]?.model ?? '')} type={type} sideColor={set.manifest.sides[color].color} onApi={noop} />
      </group>
    </group>
  );
}

/** Four clickable models from the active set floating above the board. Escape cancels. */
export function PromotionOverlay() {
  const phase = useController((s) => s.phase);
  const color = useController((s) => s.turn);
  const { choosePromotion, cancelPromotion } = useActions();
  const open = phase === 'promoting';
  useEscapeToCancel(open, cancelPromotion);
  if (!open) return null;
  return (
    <group position={[0, 1.7, 0]}>
      {CHOICES.map((t, i) => (
        <Choice key={t} type={t} color={color} x={(i - 1.5) * 1.2} onPick={() => choosePromotion(t)} />
      ))}
    </group>
  );
}
