import { useController } from '../controller/context';

export function MoveList() {
  const history = useController((s) => s.history);
  const rows: { n: number; w: string; b?: string }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({ n: i / 2 + 1, w: history[i]!.san, b: history[i + 1]?.san });
  }
  return (
    <div className="movelist" aria-label="Move list">
      {rows.length === 0 && <div style={{ opacity: 0.5 }}>No moves yet</div>}
      {rows.map((r) => (
        <div className="movelist-row" key={r.n}>
          <span className="movelist-num">{r.n}.</span>
          <span>{r.w}</span>
          <span>{r.b ?? ''}</span>
        </div>
      ))}
    </div>
  );
}
