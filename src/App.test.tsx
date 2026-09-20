import { render, screen } from '@testing-library/react';
import { App } from './App';

vi.mock('@react-three/fiber', () => ({ Canvas: () => <div data-testid="canvas" /> }));
// Scene -> CameraRig imports drei; mocking it keeps three's CJS build (and its deprecation warning) out of the test run.
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null }));
vi.mock('./engine/stockfishWorker', () => ({
  stockfishWorkerFactory: () => ({ postMessage() {}, onmessage: null, terminate() {} }),
}));

test('renders the canvas and the overlay controls', () => {
  render(<App />);
  expect(screen.getByTestId('canvas')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /new game/i })).toBeInTheDocument();
});
