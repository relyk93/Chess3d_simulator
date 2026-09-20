import { render, screen } from '@testing-library/react';
import { App } from './App';
import { FALLBACK_BOARD, FALLBACK_SET } from './packs/fallback';

vi.mock('@react-three/fiber', () => ({ Canvas: () => <div data-testid="canvas" />, useFrame: () => {}, useThree: () => ({}) }));
// The scene modules import drei and postprocessing at load time; stubbing them keeps three's CJS build (and its deprecation warning) out of the test run.
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null, Environment: () => null }));
vi.mock('@react-three/postprocessing', () => ({ EffectComposer: () => null, Bloom: () => null, Vignette: () => null, ToneMapping: () => null }));
vi.mock('postprocessing', () => ({ ToneMappingMode: { ACES_FILMIC: 0 } }));
vi.mock('./engine/stockfishWorker', () => ({
  stockfishWorkerFactory: () => ({ postMessage() {}, onmessage: null, terminate() {} }),
}));
vi.mock('./packs/loader', async (orig) => ({
  ...(await orig<typeof import('./packs/loader')>()),
  loadActivePacks: async () => ({ set: FALLBACK_SET, board: FALLBACK_BOARD }),
}));

test('renders the canvas and the overlay controls', async () => {
  render(<App />);
  expect(screen.getByTestId('canvas')).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /new game/i })).toBeInTheDocument();
});
