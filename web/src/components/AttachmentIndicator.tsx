import type { Message } from "../api";

type Props = {
  message: Pick<Message, "channel" | "attachments">;
  label: string;
};

/** Compact, accessible attachment count for email rows only. */
export function AttachmentIndicator({ message, label }: Props) {
  const count = message.attachments?.length ?? 0;
  if (message.channel !== "email" || count === 0) return null;

  const description = `${label}: ${count}`;
  return (
    <span className="msgAttachment" role="img" aria-label={description} title={description}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.19 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49" />
      </svg>
      <span aria-hidden="true">{count}</span>
    </span>
  );
}
