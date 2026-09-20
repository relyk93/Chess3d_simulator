import { useController } from '../controller/context';
import { PieceView } from './PieceView';

/** Captured pieces stay mounted so the sequencer can fade them out and undo can bring them back. */
export function Pieces() {
  const pieces = useController((s) => s.pieces);
  return (
    <group>
      {Object.entries(pieces).map(([id, placed]) => (
        <PieceView key={id} id={id} placed={placed} />
      ))}
    </group>
  );
}
