import { act, fireEvent, render, screen } from '@testing-library/react';
import { createGameCore } from '../core/gameCore';
import { createController } from '../controller/store';
import { ControllerProvider } from '../controller/context';
import { Overlay } from './Overlay';

function mount(fen?: string) {
  const store = createController({ core: createGameCore(fen), engine: null, saveSettings: () => {} });
  const onResetView = vi.fn();
  render(
    <ControllerProvider store={store}>
      <Overlay onResetView={onResetView} />
    </ControllerProvider>,
  );
  return { store, onResetView, a: store.getState().actions };
}

test('top bar buttons call the actions', () => {
  const { store, onResetView, a } = mount();
  act(() => { a.clickSquare('e2'); a.clickSquare('e4'); a.animationDone(); });
  fireEvent.click(screen.getByRole('button', { name: /undo/i }));
  expect(store.getState().history).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: /reset view/i }));
  expect(onResetView).toHaveBeenCalled();
  act(() => { a.clickSquare('e2'); a.clickSquare('e4'); });
  fireEvent.click(screen.getByRole('button', { name: /new game/i }));
  expect(store.getState().history).toHaveLength(0);
});

test('move list shows SAN in numbered pairs', () => {
  const { a } = mount();
  act(() => { a.clickSquare('e2'); a.clickSquare('e4'); a.animationDone(); });
  act(() => { a.clickSquare('e7'); a.clickSquare('e5'); a.animationDone(); });
  act(() => { a.clickSquare('g1'); a.clickSquare('f3'); a.animationDone(); });
  expect(screen.getByText('1.')).toBeInTheDocument();
  expect(screen.getByText('e4')).toBeInTheDocument();
  expect(screen.getByText('e5')).toBeInTheDocument();
  expect(screen.getByText('2.')).toBeInTheDocument();
  expect(screen.getByText('Nf3')).toBeInTheDocument();
});

test('promotion dialog appears in promoting phase and chooses a piece', () => {
  const { store, a } = mount('8/P7/8/8/8/8/8/k6K w - - 0 1');
  act(() => { a.clickSquare('a7'); a.clickSquare('a8'); });
  fireEvent.click(screen.getByRole('button', { name: /knight/i }));
  expect(store.getState().lastMove?.promotion).toBe('n');
});

test('promotion dialog cancels on Escape', () => {
  const { store, a } = mount('8/P7/8/8/8/8/8/k6K w - - 0 1');
  act(() => { a.clickSquare('a7'); a.clickSquare('a8'); });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(store.getState().phase).toBe('selected');
});

test('skip button shows only during a cinematic', () => {
  const { store, a } = mount('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  expect(screen.queryByRole('button', { name: /skip/i })).toBeNull();
  act(() => { a.clickSquare('e4'); a.clickSquare('d5'); });
  fireEvent.click(screen.getByRole('button', { name: /skip/i }));
  expect(store.getState().phase).toBe('idle');
});

test('game over banner shows the result', () => {
  const { a } = mount('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
  act(() => { a.clickSquare('h5'); a.clickSquare('f7'); a.skipCinematic(); });
  expect(screen.getByText(/checkmate/i)).toBeInTheDocument();
  expect(screen.getByText(/white wins/i)).toBeInTheDocument();
});

test('settings drawer updates settings', () => {
  const { store } = mount();
  fireEvent.click(screen.getByRole('button', { name: /settings/i }));
  fireEvent.click(screen.getByLabelText(/cinematics/i));
  expect(store.getState().settings.cinematics).toBe(false);
  fireEvent.change(screen.getByLabelText(/difficulty/i), { target: { value: '15' } });
  expect(store.getState().settings.skill).toBe(15);
});
