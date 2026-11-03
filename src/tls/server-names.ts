import { readFileSync } from "node:fs";
import { isIP } from "node:net";

export interface TlsNameSet {
  dns: string[];
  ips: string[];
}

export function parseTlsNameSet(value: unknown): TlsNameSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TLS names must be an object with dns and ips arrays");
  }
  const record = value as Record<string, unknown>;
  const dns = record.dns ?? [];
  const ips = record.ips ?? [];
  if (!Array.isArray(dns) || !Array.isArray(ips)) {
    throw new Error("TLS dns and ips must be arrays");
  }
  if ([...dns, ...ips].some((name) => typeof name !== "string")) {
    throw new Error("TLS names must be strings");
  }
  if (ips.some((name) => isIP(name) === 0 || name.includes("%"))) {
    throw new Error("Invalid TLS IP address");
  }
  return { dns, ips };
}

export function readTlsNameSet(file: string): TlsNameSet {
  return parseTlsNameSet(JSON.parse(readFileSync(file, "utf8")));
}

export function resolveTlsServerNames(options: {
  environment?: string;
  publicHost?: string;
  file?: TlsNameSet;
  managed?: TlsNameSet;
}): string[] {
  const candidates = [
    ...(options.environment ?? "localhost,127.0.0.1").split(","),
    ...(options.file?.dns ?? []),
    ...(options.file?.ips ?? []),
    ...(options.managed?.dns ?? []),
    ...(options.managed?.ips ?? []),
    options.publicHost ?? "localhost",
  ];
  const names = candidates.map((value) => value.trim().toLowerCase())
    .filter((value) => value !== "" && value !== "0.0.0.0" && value !== "::");
  for (const name of names) {
    if (name.length > 253 || name.includes("%")) throw new Error("Invalid TLS server name");
    if (isIP(name)) continue;
    const labels = name.replace(/\.$/, "").split(".");
    if (labels.some((label) => !label || label.length > 63 ||
      !/^[a-z0-9-]+$/.test(label) || label.startsWith("-") || label.endsWith("-"))) {
      throw new Error("Invalid TLS DNS name");
    }
  }
  const unique = [...new Set(names)].sort((left, right) => left.localeCompare(right));
  if (unique.length === 0) throw new Error("At least one TLS server name is required");
  return unique;
}
