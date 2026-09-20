import { useState } from 'react';
import { useController } from '../controller/context';

export function MoveList() {
  const history = useController((s) => s.history);
  const [open, setOpen] = useState(true);
  const rows: { n: number; w: string; b?: string }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({ n: i / 2 + 1, w: history[i]!.san, b: history[i + 1]?.san });
  }
  return (
    <div className="movelist" aria-label="Move list">
      <button className="movelist-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>Moves</span>
        <span aria-hidden="true">{open ? '\u2212' : '+'}</span>
      </button>
      {open && rows.length === 0 && <div style={{ opacity: 0.5 }}>No moves yet</div>}
      {open && rows.map((r) => (
        <div className="movelist-row" key={r.n}>
          <span className="movelist-num">{r.n}.</span>
          <span>{r.w}</span>
          <span>{r.b ?? ''}</span>
        </div>
      ))}
    </div>
  );
}
