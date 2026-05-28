/**
 * Agent proxy state machine.
 * Mirrors opencan-daemon/internal/proxy/state.go.
 *
 *   Starting ──→ Idle ──→ Prompting ──→ Draining ──→ Completed
 *                  │           │            │              │
 *                  └───────────┴────────────┴──────────────┘
 *                              ↓
 *                            Dead (terminal)
 */

export enum ProxyState {
  /** Process is spawning, waiting for initialize + session/new handshake */
  Starting = 'starting',

  /** Ready, waiting for input (no active prompt) */
  Idle = 'idle',

  /** A prompt is being executed (client attached) */
  Prompting = 'prompting',

  /** Client disconnected while prompt was running */
  Draining = 'draining',

  /** Prompt completed but no client attached */
  Completed = 'completed',

  /** ACP process has exited — terminal state */
  Dead = 'dead',

  /** Session exists on disk but is not managed by this daemon */
  External = 'external',
}

const VALID_TRANSITIONS: Record<ProxyState, ProxyState[]> = {
  [ProxyState.Starting]:   [ProxyState.Idle, ProxyState.Dead],
  [ProxyState.Idle]:       [ProxyState.Prompting, ProxyState.Dead],
  [ProxyState.Prompting]:  [ProxyState.Draining, ProxyState.Idle, ProxyState.Dead],
  [ProxyState.Draining]:   [ProxyState.Prompting, ProxyState.Completed, ProxyState.Dead],
  [ProxyState.Completed]:  [ProxyState.Idle, ProxyState.Dead],
  [ProxyState.Dead]:       [], // terminal — no transitions out
  [ProxyState.External]:   [ProxyState.Idle, ProxyState.Dead],
};

export function canTransition(from: ProxyState, to: ProxyState): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function stateLabel(state: ProxyState): string {
  return state;
}

/**
 * State machine with guarded transitions.
 * Strict: rejects transitions from Dead (logs warning).
 */
export class StateMachine {
  private _current: ProxyState;
  private _previous: ProxyState | null = null;

  constructor(initial: ProxyState = ProxyState.Starting) {
    this._current = initial;
  }

  get current(): ProxyState {
    return this._current;
  }

  get previous(): ProxyState | null {
    return this._previous;
  }

  transition(to: ProxyState): boolean {
    if (this._current === ProxyState.Dead) {
      console.warn(`[StateMachine] Rejected transition Dead → ${to} (terminal state)`);
      return false;
    }

    if (!canTransition(this._current, to)) {
      console.warn(
        `[StateMachine] Invalid transition: ${this._current} → ${to}`
      );
      return false;
    }

    this._previous = this._current;
    this._current = to;
    return true;
  }

  /** Force set state (bypasses validation) — use only for Dead */
  force(to: ProxyState): void {
    this._previous = this._current;
    this._current = to;
  }

  isAlive(): boolean {
    return this._current !== ProxyState.Dead;
  }

  toString(): string {
    return `StateMachine(${this._previous ?? 'none'} → ${this._current})`;
  }
}
