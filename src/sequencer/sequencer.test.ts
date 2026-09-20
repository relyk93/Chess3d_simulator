import { createSequencer, sequenceDuration } from './sequencer';
import { createFakeClock, createRecordingHandles } from './testing';
import type { Sequence } from './types';

const seq: Sequence = {
  steps: [
    { at: 0, duration: 500, kind: 'piece.moveTo', id: 'a', to: 'e4' },
    { at: 200, duration: 0, kind: 'audio.play', sound: 'hit' },
    { at: 200, duration: 300, kind: 'piece.play', id: 'a', clip: 'attack' },
    { at: 1000, duration: 400, kind: 'piece.fadeOut', id: 'b' },
  ],
};

function setup() {
  const clock = createFakeClock();
  const { handles, calls } = createRecordingHandles(clock);
  const sequencer = createSequencer(clock);
  return { clock, handles, calls, sequencer };
}

test('sequenceDuration is the latest step end', () => {
  expect(sequenceDuration(seq)).toBe(1400);
  expect(sequenceDuration({ steps: [] })).toBe(0);
});

test('holds involved pieces, runs t=0 steps synchronously, then fires each step at its start offset', () => {
  const { clock, handles, calls, sequencer } = setup();
  sequencer.run(seq, handles);
  expect(calls.map((c) => `${c.t}:${c.who}.${c.method}`)).toEqual(['0:piece.hold', '0:piece.hold', '0:piece.moveTo']);
  clock.advance(199);
  expect(calls).toHaveLength(3);
  clock.advance(1);
  expect(calls.slice(3).map((c) => `${c.t}:${c.who}.${c.method}`)).toEqual(['200:audio.play', '200:piece.play']);
  clock.advance(800);
  expect(calls.at(-1)).toMatchObject({ t: 1000, method: 'fadeOut', id: 'b', ms: 400 });
});

test('resolves done at the end, finishing every touched handle first', async () => {
  const { clock, handles, calls, sequencer } = setup();
  const { done } = sequencer.run(seq, handles);
  let resolved = false;
  void done.then(() => { resolved = true; });
  clock.advance(1399);
  await Promise.resolve();
  expect(resolved).toBe(false);
  clock.advance(1);
  await done;
  expect(resolved).toBe(true);
  const finished = calls.filter((c) => c.method === 'finish').map((c) => (c as { id?: string }).id);
  expect(finished.sort()).toEqual(['a', 'b']);
});

test('skip applies unstarted steps at zero duration, drops sounds and clips, finishes handles, resolves done', async () => {
  const { clock, handles, calls, sequencer } = setup();
  const { done, skip } = sequencer.run(seq, handles);
  clock.advance(100);
  calls.length = 0;
  skip();
  await done;
  expect(calls.map((c) => `${c.who}.${c.method}`)).toEqual(['piece.fadeOut', 'piece.finish', 'piece.finish']);
  expect(calls[0]).toMatchObject({ id: 'b', ms: 0 });
  // Nothing fires afterwards.
  calls.length = 0;
  clock.advance(5000);
  expect(calls).toEqual([]);
});

test('skip is idempotent and a no-op after natural completion', async () => {
  const { clock, handles, calls, sequencer } = setup();
  const { done, skip } = sequencer.run(seq, handles);
  clock.advance(2000);
  await done;
  calls.length = 0;
  skip();
  skip();
  expect(calls).toEqual([]);
});

test('a throwing handle does not stall the sequence', async () => {
  const { clock, handles, sequencer } = setup();
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const broken = { ...handles, piece: () => { throw new Error('no such piece'); } };
  const { done } = sequencer.run(seq, broken);
  clock.advance(2000);
  await done;
  expect(err).toHaveBeenCalled();
  err.mockRestore();
});
