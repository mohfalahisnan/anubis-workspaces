export type CdpResponseMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

export type CdpEventHandler = (params: unknown) => void | Promise<void>;

type WebSocketConstructor = new (url: string) => WebSocketLike;

type WebSocketLike = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  addEventListener: (type: "open" | "message" | "error" | "close", listener: (event: WebSocketEventLike) => void) => void;
};

type WebSocketEventLike = {
  data?: unknown;
  error?: unknown;
};

export type CdpSession = {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(method: string, handler: CdpEventHandler): void;
  close(): void;
};

export async function connectCdpSession(
  webSocketUrl: string,
  webSocketConstructor: WebSocketConstructor = getGlobalWebSocket()
): Promise<CdpSession> {
  const socket = new webSocketConstructor(webSocketUrl);
  await waitForSocketOpen(socket);

  let nextId = 1;
  const pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  const handlers = new Map<string, CdpEventHandler[]>();

  socket.addEventListener("message", (event) => {
    const message = parseCdpMessage(event.data);
    if (!message) return;

    if (typeof message.id === "number") {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(message.error.message || "CDP command failed."));
      } else {
        entry.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      for (const handler of handlers.get(message.method) ?? []) {
        void handler(message.params);
      }
    }
  });

  socket.addEventListener("close", () => {
    for (const entry of pending.values()) {
      entry.reject(new Error("CDP socket closed."));
    }
    pending.clear();
  });

  return {
    send<T = unknown>(method: string, params: Record<string, unknown> = {}) {
      const id = nextId++;
      const command = { id, method, params };
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        socket.send(JSON.stringify(command));
      });
    },
    on(method, handler) {
      handlers.set(method, [...(handlers.get(method) ?? []), handler]);
    },
    close() {
      socket.close();
    }
  };
}

function waitForSocketOpen(socket: WebSocketLike): Promise<void> {
  if (socket.readyState === 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", (event) => reject(event.error instanceof Error ? event.error : new Error("CDP socket failed.")));
  });
}

function parseCdpMessage(data: unknown): CdpResponseMessage | null {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as CdpResponseMessage;
  } catch {
    return null;
  }
}

function getGlobalWebSocket(): WebSocketConstructor {
  const webSocketConstructor = (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (!webSocketConstructor) {
    throw new Error("This Node.js runtime does not provide WebSocket.");
  }
  return webSocketConstructor;
}
