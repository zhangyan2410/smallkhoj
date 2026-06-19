export interface RuntimeLineEvent {
  stream: 'stdout' | 'stderr';
  line: string;
}

export interface RuntimeExitEvent {
  code: number | null;
  signal: NodeJS.Signals | null;
  intentional: boolean;
  sessionId?: string;
}

export type RuntimeStreamEvent = Record<string, unknown> & {
  type?: string;
  subtype?: string;
  session_id?: string;
  sessionId?: string;
};

export interface ManagedRuntimeDriver {
  start(): void;
  stop(): void;
  killUnresponsive(): void;
  sendUserMessage(text: string): boolean;
  readonly pid: number | undefined;
  readonly sessionId: string | undefined;
  readonly queuedMessageCount: number;
  readonly busy: boolean;
  on(event: 'line', listener: (event: RuntimeLineEvent) => void): this;
  on(event: 'stream_event', listener: (event: RuntimeStreamEvent) => void): this;
  on(event: 'session', listener: (event: { sessionId: string }) => void): this;
  on(event: 'message_sent', listener: (payload: unknown) => void): this;
  on(event: 'exit', listener: (event: RuntimeExitEvent) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
}
