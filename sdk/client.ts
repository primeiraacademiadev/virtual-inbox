/** Native-fetch SDK for disposable email and SMS integration tests (Node.js 24+). */
export type Channel = "email" | "sms";
export type Inbox = {
  id: string;
  channel: Channel;
  address: string;
  createdAt: string;
  expiresAt: string | null;
  system?: boolean;
};
export type AttachmentInfo = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
};
export type MailHeader = { key: string; originalKey: string; value: string };
export type MailEnvelope = { mailFrom: string; rcptTo: string[] };
export type DecodedMailbox = { name: string; address: string };
export type InboxMessage = {
  id: string;
  sequence: number;
  channel: Channel;
  destinationId: string;
  from: string;
  originalRecipient: string;
  subject?: string;
  body: string;
  html?: string;
  /** Unfolded but otherwise raw MIME values, including encoded display names. */
  headers?: MailHeader[];
  /** RFC 2047-decoded MIME From; does not replace the original header. */
  decodedFrom?: DecodedMailbox;
  envelope?: MailEnvelope;
  authUser?: string;
  smtpSessionId?: string;
  attachments?: AttachmentInfo[];
  receivedAt?: string;
  captureReason?: "UNKNOWN_RECIPIENT" | "EXPIRED_RECIPIENT";
};
export type MessageMatch = {
  from?: string;
  subjectContains?: string;
  bodyContains?: string;
  htmlContains?: string;
  header?: { name: string; valueContains: string };
};

export class VirtualInboxClient {
  constructor(readonly baseUrl = "http://127.0.0.1:3000") {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
    if (res.status === 204) return null as T;
    if (!res.ok) throw Error("Virtual Inbox HTTP " + res.status + ": " + await res.text());
    return await res.json() as T;
  }

  private path(inbox: Inbox): string {
    return (inbox.channel === "email" ? "/mailboxes/" : "/phone-numbers/") + encodeURIComponent(inbox.id);
  }

  create(channel: Channel, address?: string, ttlSeconds = 1800): Promise<Inbox> {
    return this.request(channel === "email" ? "/mailboxes" : "/phone-numbers", {
      method: "POST",
      body: JSON.stringify({
        [channel === "email" ? "address" : "phoneNumber"]: address,
        ttlSeconds,
      }),
    });
  }

  messages(inbox: Inbox): Promise<InboxMessage[]> {
    return this.request(this.path(inbox) + "/messages");
  }

  /**
   * Wait for an existing or new message. after is an exclusive message sequence cursor,
   * not an SSE event ID. Returns null on HTTP 204 (timeout/inbox removal).
   */
  wait(inbox: Inbox, match: MessageMatch, timeoutMs = 10000, after = 0): Promise<InboxMessage | null> {
    return this.request(this.path(inbox) + "/wait-for-message", {
      method: "POST",
      body: JSON.stringify({ match, timeoutMs, after }),
    });
  }

  async download(inbox: Inbox, messageId: string, attachmentId: string): Promise<Uint8Array> {
    const url = this.path(inbox) + "/messages/" + encodeURIComponent(messageId)
      + "/attachments/" + encodeURIComponent(attachmentId);
    const response = await fetch(new URL(url, this.baseUrl));
    if (!response.ok) throw Error("Download failed: " + response.status);
    return new Uint8Array(await response.arrayBuffer());
  }

  delete(inbox: Inbox): Promise<void> {
    return this.request(this.path(inbox), { method: "DELETE" });
  }

  async withInbox<T>(channel: Channel, fn: (inbox: Inbox) => Promise<T>, address?: string, ttlSeconds = 1800): Promise<T> {
    const inbox = await this.create(channel, address, ttlSeconds);
    try {
      return await fn(inbox);
    } finally {
      await this.delete(inbox);
    }
  }
}
