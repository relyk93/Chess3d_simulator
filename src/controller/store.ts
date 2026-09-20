import { createStore, type StoreApi } from 'zustand/vanilla';
import type { GameCore } from '../core/gameCore';
import type { Engine } from '../engine/engine';
import type { Color, GameOverReason, MoveRequest, MoveResult, PromotionPiece, Square } from '../core/types';
import { applyMove, initialPieces, revertMove, type PieceMap } from './pieceTracker';
import { DEFAULT_SETTINGS, saveSettings as persistSettings, type Settings } from './settings';

export type Phase = 'idle' | 'selected' | 'promoting' | 'engineThinking' | 'animatingMove' | 'cinematic' | 'gameOver';
export type EngineStatus = 'none' | 'starting' | 'ready' | 'failed';

export interface ControllerState {
  phase: Phase;
  pieces: PieceMap;
  selected: Square | null;
  legalTargets: Square[];
  lastMove: MoveResult | null;
  history: MoveResult[];
  pendingPromotion: { from: Square; to: Square } | null;
  turn: Color;
  inCheck: boolean;
  gameOver: GameOverReason | null;
  settings: Settings;
  engineStatus: EngineStatus;
  engineError: string | null;
}

export interface ControllerActions {
  clickSquare(sq: Square): void;
  choosePromotion(p: PromotionPiece): void;
  cancelPromotion(): void;
  skipCinematic(): void;
  undo(): void;
  newGame(): void;
  updateSettings(patch: Partial<Settings>): void;
  animationDone(): void;
}

export interface ControllerDeps {
  core: GameCore;
  engine?: Engine | null;
  settings?: Settings;
  saveSettings?: (s: Settings) => void;
  humanColor?: Color;
  moveTimeMs?: number;
}

export type ControllerStore = StoreApi<ControllerState & { actions: ControllerActions }>;

const CLEAR_SELECTION = { selected: null, legalTargets: [] as Square[], pendingPromotion: null };

export function createController(deps: ControllerDeps): ControllerStore {
  const { core } = deps;
  const engine = deps.engine ?? null;
  const humanColor = deps.humanColor ?? 'w';
  const moveTimeMs = Math.min(2000, deps.moveTimeMs ?? 1500);
  const save = deps.saveSettings ?? persistSettings;
  let requestSeq = 0;
  let retried = false;

  // Declared before the store so helpers can close over it.
  let store: ControllerStore;
  const get = () => store.getState();
  const set = (patch: Partial<ControllerState>) => store.setState(patch);

  const snapshot = () => ({ turn: core.turn(), inCheck: core.inCheck(), gameOver: core.gameOver() });

  const isHumanTurn = () => get().settings.twoPlayer || core.turn() === humanColor;
  const engineShouldMove = () =>
    engine !== null && !get().settings.twoPlayer && get().engineStatus === 'ready' && core.turn() !== humanColor;

  function commitMove(req: MoveRequest) {
    const s = get();
    const ply = s.history.length;
    const r = core.move(req);
    const pieces = applyMove(s.pieces, r, ply);
    const phase: Phase = r.captured && s.settings.cinematics ? 'cinematic' : 'animatingMove';
    set({ pieces, history: [...s.history, r], lastMove: r, phase, ...CLEAR_SELECTION, ...snapshot() });
  }

  /** Spec section 10: an illegal move reaching the core is a bug; log it and return to idle. */
  function safeCommit(req: MoveRequest) {
    try {
      commitMove(req);
    } catch (e) {
      console.error('Illegal move reached the core', req, e);
      set({ phase: 'idle', ...CLEAR_SELECTION });
    }
  }

  function failEngine(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const settings = { ...get().settings, twoPlayer: true };
    save(settings);
    set({ engineStatus: 'failed', engineError: message, settings, phase: 'idle' });
  }

  function requestEngineMove() {
    if (!engine) return set({ phase: 'idle' });
    const seq = ++requestSeq;
    set({ phase: 'engineThinking' });
    engine.bestMove(core.fen(), moveTimeMs).then(
      (req) => {
        if (seq !== requestSeq || get().phase !== 'engineThinking') return;
        retried = false;
        try {
          commitMove(req);
        } catch (e) {
          failEngine(e);
        }
      },
      (err: unknown) => {
        if (seq !== requestSeq) return;
        if (err instanceof Error && /stopped/i.test(err.message)) return;
        if (!retried) {
          retried = true;
          requestEngineMove();
          return;
        }
        failEngine(err);
      },
    );
  }

  function afterMove() {
    const over = core.gameOver();
    if (over) return set({ phase: 'gameOver', gameOver: over });
    if (engineShouldMove()) return requestEngineMove();
    set({ phase: 'idle' });
  }

  function undoOne() {
    const s = get();
    const r = core.undo();
    if (!r) return;
    const ply = s.history.length - 1;
    const history = s.history.slice(0, -1);
    set({ pieces: revertMove(s.pieces, r, ply), history, lastMove: history.at(-1) ?? null });
  }

  const actions: ControllerActions = {
    clickSquare(sq) {
      const s = get();
      if (s.phase !== 'idle' && s.phase !== 'selected') return;
      if (!isHumanTurn()) return;
      if (s.phase === 'selected' && s.selected) {
        if (sq === s.selected) return set({ phase: 'idle', ...CLEAR_SELECTION });
        if (s.legalTargets.includes(sq)) {
          if (core.needsPromotion(s.selected, sq)) {
            return set({ phase: 'promoting', pendingPromotion: { from: s.selected, to: sq } });
          }
          return safeCommit({ from: s.selected, to: sq });
        }
      }
      const piece = core.pieceAt(sq);
      if (piece && piece.color === core.turn()) {
        return set({ phase: 'selected', selected: sq, legalTargets: core.legalMoves(sq), pendingPromotion: null });
      }
      set({ phase: 'idle', ...CLEAR_SELECTION });
    },
    choosePromotion(p) {
      const s = get();
      if (s.phase !== 'promoting' || !s.pendingPromotion) return;
      safeCommit({ ...s.pendingPromotion, promotion: p });
    },
    cancelPromotion() {
      if (get().phase !== 'promoting') return;
      set({ phase: 'selected', pendingPromotion: null });
    },
    animationDone() {
      const p = get().phase;
      if (p !== 'animatingMove' && p !== 'cinematic') return;
      afterMove();
    },
    skipCinematic() {
      if (get().phase !== 'cinematic') return;
      afterMove();
    },
    undo() {
      const p = get().phase;
      if (p === 'promoting' || p === 'animatingMove' || p === 'cinematic') return;
      if (p === 'engineThinking') {
        requestSeq++;
        engine?.stop();
        undoOne();
      } else {
        undoOne();
        if (!get().settings.twoPlayer && core.turn() !== humanColor) undoOne();
      }
      set({ phase: 'idle', ...CLEAR_SELECTION, ...snapshot() });
    },
    newGame() {
      if (get().phase === 'engineThinking') engine?.stop();
      requestSeq++;
      core.reset();
      set({ phase: 'idle', pieces: initialPieces(core), lastMove: null, history: [], ...CLEAR_SELECTION, ...snapshot() });
    },
    updateSettings(patch) {
      const settings = { ...get().settings, ...patch };
      save(settings);
      set({ settings });
      if (patch.skill !== undefined && engine && get().engineStatus === 'ready') engine.setSkill(patch.skill);
      if (patch.twoPlayer === false && get().phase === 'idle' && engineShouldMove()) requestEngineMove();
    },
  };

  store = createStore<ControllerState & { actions: ControllerActions }>()(() => ({
    phase: 'idle',
    pieces: initialPieces(core),
    lastMove: null,
    history: [],
    ...CLEAR_SELECTION,
    ...snapshot(),
    settings: deps.settings ? { ...deps.settings } : { ...DEFAULT_SETTINGS },
    engineStatus: engine ? 'starting' : 'none',
    engineError: null,
    actions,
  }));

  if (engine) {
    engine.ready().then(
      () => {
        engine.setSkill(get().settings.skill);
        set({ engineStatus: 'ready' });
        if (get().phase === 'idle' && engineShouldMove()) requestEngineMove();
      },
      (err: unknown) => failEngine(err),
    );
  }

  return store;
}
