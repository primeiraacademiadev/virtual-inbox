import { Fault } from "./domain-types.js";

/** Explicit process environment always takes precedence over legacy persisted settings. */
export function resolveNetworkSetting(
  environment: NodeJS.ProcessEnv, persisted: Record<string, string>, key: string, fallback: string,
): string {
  return environment[key] ?? persisted[key] ?? fallback;
}

/** Keys owned by the deployment configuration are read-only at the legacy admin API. */
export function environmentControlledKeys(
  environment: NodeJS.ProcessEnv, keys: readonly string[],
): string[] {
  return keys.filter((key) => environment[key] !== undefined);
}

/** Diagnose shadowed legacy file entries without logging any values. */
export function shadowedNetworkKeys(
  environment: NodeJS.ProcessEnv, persisted: Record<string, string>,
): string[] {
  return Object.keys(persisted).filter((key) =>
    environment[key] !== undefined && environment[key] !== persisted[key]);
}

/**
 * Forbid an apparently successful persisted update which will be ignored at restart.
 * Accept unchanged environment-owned values for backward compatibility with callers
 * that submit a full connection-info payload.
 */
export function assertWritableNetworkSettings(
  values: Record<string, string>, environment: NodeJS.ProcessEnv,
): void {
  const blocked = Object.keys(values).filter((key) =>
    environment[key] !== undefined && environment[key] !== values[key]);
  if (blocked.length) {
    throw new Fault(409,
      "Network settings are controlled by environment variables: " + blocked.join(", "),
      "NETWORK_SETTINGS_ENV_CONTROLLED");
  }
}
