import { randomUUID } from "node:crypto";
export const positive = (key: string, fallback: number) => {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw Error("Invalid " + key);
  return value;
};
/**
 * Only explicitly modelled phone profiles may be used for national-number
 * routing. A bare country code is insufficient to infer a numbering plan.
 */
export function parseSmsDefaultCountryCode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^\\+[1-9][0-9]{0,2}$/.test(value) ||
      !["+351", "+1", "+33"].includes(value)) {
    throw Error("Invalid SMS_DEFAULT_COUNTRY_CODE (supported: +351, +1, +33)");
  }
  return value;
}
export const config = {
  smtpBytes: positive("MAX_SMTP_MESSAGE_BYTES", 20 * 1024 * 1024),
  attachmentBytes: positive("MAX_ATTACHMENT_BYTES", 20 * 1024 * 1024),
  httpBytes: positive("MAX_HTTP_BODY_BYTES", 32 * 1024 * 1024),
  smsBytes: positive("MAX_SMS_BODY_BYTES", 64 * 1024),
  smsDefaultCountryCode: parseSmsDefaultCountryCode(process.env.SMS_DEFAULT_COUNTRY_CODE),
  bodyChars: positive("MAX_MESSAGE_BODY_CHARS", 2 * 1024 * 1024),
  messages: positive("MAX_MESSAGE_COUNT", 10000),
  storedBytes: positive("MAX_STORED_BYTES", 256 * 1024 * 1024),
  logs: positive("MAX_LOG_ENTRIES", 2000), // legacy entry-count fallback for programmatic Sandbox users
  logBytes: positive("MAX_LOG_BUFFER_BYTES", 10 * 1024 * 1024),
  defaultTtl: positive("DEFAULT_INBOX_TTL_SECONDS", 1800),
  maxTtl: positive("MAX_INBOX_TTL_SECONDS", 604800),
  observerTtl: positive("OBSERVER_SESSION_TTL_SECONDS", 3600),
  waitMs: positive("MAX_WAIT_TIMEOUT_MS", 120000),
  maxConnections: positive("MAX_CONNECTIONS", 200),
  smtpSessionHistoryHours: positive("SMTP_SESSION_HISTORY_HOURS", 24),
  smtpSimulationMaxDurationMs: positive("SMTP_SIMULATION_MAX_DURATION_MS", 10000),
  maxInboxes: positive("MAX_INBOX_COUNT", 2000),
  maxObservers: positive("MAX_OBSERVER_COUNT", 500),
  maxAttachments: positive("MAX_ATTACHMENTS_PER_MESSAGE", 20),
};
export function getSize(bytes: Buffer | string) {
  return Buffer.isBuffer(bytes) ? bytes.length : Buffer.byteLength(bytes);
}
export function token() {
  return randomUUID();
}
