import { useActions, useController } from '../controller/context';
import { PlaceholderPiece } from './PlaceholderPiece';

export function Pieces() {
  const pieces = useController((s) => s.pieces);
  const { clickSquare } = useActions();
  return (
    <group>
      {Object.entries(pieces)
        .filter(([, p]) => !p.captured)
        .map(([id, p]) => (
          <PlaceholderPiece key={id} piece={p.piece} square={p.square} onClick={() => clickSquare(p.square)} />
        ))}
    </group>
  );
}
