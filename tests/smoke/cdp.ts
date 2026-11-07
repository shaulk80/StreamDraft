// A minimal Chrome DevTools Protocol client over the WebSocket built into Node, so the
// Chrome smoke test needs no chromedriver and no extra package. It sends commands and
// waits for their answers; events are ignored.

interface Answer {
  id: number;
  result?: unknown;
  error?: { message: string };
}

export class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  private readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event: MessageEvent<string>) => this.onMessage(event.data));
    socket.addEventListener('close', () => this.rejectAll(new Error('The DevTools connection closed.')));
  }

  static connect(url: string): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolve(new CdpConnection(socket)));
      socket.addEventListener('error', () => reject(new Error(`Could not connect to ${url}`)));
    });
  }

  /** Sends a command. A protocol error rejects, which the smoke test reports as a failed check. */
  send<T = unknown>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  close(): void {
    this.socket.close();
  }

  private onMessage(data: string): void {
    const answer = JSON.parse(data) as Answer;
    const waiting = this.pending.get(answer.id);
    if (!waiting) {
      return;
    }

    this.pending.delete(answer.id);
    if (answer.error) {
      waiting.reject(new Error(answer.error.message));
      return;
    }
    waiting.resolve(answer.result);
  }

  private rejectAll(error: Error): void {
    for (const waiting of this.pending.values()) {
      waiting.reject(error);
    }
    this.pending.clear();
  }
}
