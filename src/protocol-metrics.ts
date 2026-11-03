export type ProtocolName = "SMTP" | "POP3";
export type ProtocolMetrics = {
  connectionsTotal: number;
  connectionsActive: number;
  authentications: number;
  commands: number;
  messages: number;
  errors: number;
  simulatedErrors: number;
};
/** Volatile counters for the disposable sandbox; never based on secret values. */
export class ProtocolCounters {
  private readonly values: Record<ProtocolName, ProtocolMetrics> = {
    SMTP: { connectionsTotal: 0, connectionsActive: 0, authentications: 0, commands: 0, messages: 0, errors: 0, simulatedErrors: 0 },
    POP3: { connectionsTotal: 0, connectionsActive: 0, authentications: 0, commands: 0, messages: 0, errors: 0, simulatedErrors: 0 },
  };
  connect(protocol: ProtocolName) {
    this.values[protocol].connectionsTotal++;
    this.values[protocol].connectionsActive++;
  }
  disconnect(protocol: ProtocolName) {
    this.values[protocol].connectionsActive = Math.max(0, this.values[protocol].connectionsActive-1);
  }
  auth(protocol: ProtocolName) { this.values[protocol].authentications++; }
  command(protocol: ProtocolName) { this.values[protocol].commands++; }
  message(protocol: ProtocolName) { this.values[protocol].messages++; }
  error(protocol: ProtocolName, simulated = false) {
    this.values[protocol].errors++;
    if (simulated) this.values[protocol].simulatedErrors++;
  }
  snapshot() { return { SMTP: { ...this.values.SMTP }, POP3: { ...this.values.POP3 } }; }
}
