/** Bind listeners sequentially; either every listener starts, or all started listeners close. */
export type ListenerEndpoint = { name: string; port: number; host: string };
export type ListenerSpec = ListenerEndpoint & { server: {
  listen(port: number, host: string, callback: () => void): unknown;
  close(callback?: () => void): unknown;
  once(event: string, listener: (error: Error) => void): unknown;
  removeListener(event: string, listener: (error: Error) => void): unknown;
} };

async function bind(spec: ListenerSpec): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      spec.server.removeListener("error", onError);
      reject(new Error(spec.name + " port " + spec.port + ": " + error.message, { cause: error }));
    };
    spec.server.once("error", onError);
    try {
      spec.server.listen(spec.port, spec.host, () => {
        spec.server.removeListener("error", onError);
        resolve();
      });
    } catch (error) {
      spec.server.removeListener("error", onError);
      reject(error);
    }
  });
}

async function closeStarted(spec: ListenerSpec): Promise<void> {
  await new Promise<void>((resolve) => {
    try { spec.server.close(() => resolve()); } catch { resolve(); }
  });
}

export async function startFixedListeners(
  specs: readonly ListenerSpec[],
  onStarted?: (endpoint: ListenerEndpoint) => void,
): Promise<ListenerEndpoint[]> {
  // Validate configuration before exposing any network listener. Port 0 remains
  // supported for existing managed test subprocesses, not for normal deployment.
  for (const spec of specs) {
    if (!Number.isInteger(spec.port) || spec.port < 0 || spec.port > 65535)
      throw new Error("Invalid port for " + spec.name + ": " + spec.port);
  }
  const started: ListenerSpec[] = [];
  try {
    for (const spec of specs) {
      await bind(spec);
      started.push(spec);
      onStarted?.({ name: spec.name, port: spec.port, host: spec.host });
    }
    return started.map(({ name, port, host }) => ({ name, port, host }));
  } catch (error) {
    await Promise.allSettled(started.reverse().map(closeStarted));
    throw error;
  }
}
