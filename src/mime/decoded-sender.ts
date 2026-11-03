import type { DecodedMailbox } from "../core.js";

/** Convert postal-mime's decoded From mailbox without altering MIME header values. */
export function decodedSender(
  parsed: { name: string; address?: string } | null | undefined,
): DecodedMailbox | undefined {
  if (!parsed || typeof parsed.address !== "string") return undefined;
  return { name: parsed.name, address: parsed.address };
}
