/**
 * Thread-safe ring buffer for JSON-RPC notifications.
 * Mirrors opencan-daemon/internal/proxy/event_buffer.go.
 *
 * - Append: O(1) amortized, evicts oldest when over capacity
 * - Since(afterSeq): returns all events with seq > afterSeq
 * - Clone-on-evict to avoid GC pinning stale slices
 */

export interface BufferedEvent {
  seq: number;
  method: string;
  params: unknown;
  timestamp: number; // Date.now()
}

export class EventBuffer {
  private events: (BufferedEvent | undefined)[];
  private capacity: number;
  private head = 0; // write cursor
  private _size = 0;
  private nextSeq = 1;
  private _lastAppendAt = 0;

  constructor(capacity = 100_000) {
    this.capacity = Math.max(1, capacity);
    this.events = new Array(this.capacity);
  }

  // ── Write ──────────────────────────────────────────────────

  append(method: string, params: unknown): number {
    const seq = this.nextSeq++;
    const event: BufferedEvent = {
      seq,
      method,
      params,
      timestamp: Date.now(),
    };

    if (this._size === this.capacity) {
      // Eviction: allocate new backing array so old refs can be GC'd
      const fresh: (BufferedEvent | undefined)[] = new Array(this.capacity);
      // Copy all but oldest
      for (let i = 0; i < this.capacity - 1; i++) {
        fresh[i] = this.events[(this.head + i + 1) % this.capacity];
      }
      fresh[this.capacity - 1] = event;
      this.events = fresh;
      this.head = 0;
      // size stays at capacity
    } else {
      const idx = (this.head + this._size) % this.capacity;
      this.events[idx] = event;
      this._size++;
    }

    this._lastAppendAt = Date.now();
    return seq;
  }

  // ── Read ───────────────────────────────────────────────────

  /**
   * Returns a snapshot of events with seq > @param afterSeq, ordered by seq.
   * Thread-safe: copies the relevant slice.
   */
  since(afterSeq: number): BufferedEvent[] {
    // Collect matching events
    const result: BufferedEvent[] = [];
    for (let i = 0; i < this._size; i++) {
      const idx = (this.head + i) % this.capacity;
      const event = this.events[idx];
      if (event && event.seq > afterSeq) {
        result.push(event);
      }
    }
    return result;
  }

  /** Snapshot of all events */
  snapshot(): BufferedEvent[] {
    return this.since(0);
  }

  // ── Properties ─────────────────────────────────────────────

  get size(): number {
    return this._size;
  }

  get lastAppendAt(): number {
    return this._lastAppendAt;
  }

  get latestSeq(): number {
    return this.nextSeq - 1;
  }

  clear(): void {
    this.events = new Array(this.capacity);
    this.head = 0;
    this._size = 0;
    this.nextSeq = 1;
  }
}
