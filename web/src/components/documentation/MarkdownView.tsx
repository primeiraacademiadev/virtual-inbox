import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const documents = new Set([
  "overview", "demo", "integration", "sdk", "api", "tls", "architecture", "development",
]);
const downloads: Record<string, string> = {
  "/api/openapi.json": "virtual-inbox-openapi.json",
  "/api/openapi-demo.json": "virtual-inbox-demo-openapi.json",
  "/api/tls/ca.pem": "virtual-inbox-ca.pem",
  "/api/tls/certificate.pem": "virtual-inbox-server.pem",
};
type Props = { markdown: string; onDocument: (id: string) => void };

export function MarkdownView({ markdown, onDocument }: Props) {
  let headingOrdinal = 0;
  function navigate(href: string) {
    const [raw, anchor] = href.split("#", 2);
    if (!raw && anchor) {
      const id = decodeURIComponent(anchor);
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    const normalized = raw.replace(/^\.\.\//, "").replace(/^docs\//, "");
    const id = normalized === "README.md" ? "overview"
      : normalized.endsWith(".md") ? normalized.slice(0, -3) : normalized;
    if (documents.has(id)) {
      onDocument(id);
      return;
    }
    if (normalized.startsWith("/") || normalized.includes("..")) return;
    window.open(
      "https://github.com/primeiraacademiadev/virtual-inbox/blob/main/" + encodeURI(normalized),
      "_blank", "noopener,noreferrer",
    );
  }
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 id={"doc-heading-" + ++headingOrdinal}>{children}</h1>,
        h2: ({ children }) => <h2 id={"doc-heading-" + ++headingOrdinal}>{children}</h2>,
        h3: ({ children }) => <h3 id={"doc-heading-" + ++headingOrdinal}>{children}</h3>,
        a: ({ href, children }) => {
          if (!href) return <>{children}</>;
          if (Object.hasOwn(downloads, href)) {
            return <a href={href} download={downloads[href]}>{children}</a>;
          }
          if (/^https?:\/\//i.test(href)) {
            return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
          }
          return (
            <a href={href} onClick={(event) => {
              event.preventDefault();
              navigate(href);
            }}>{children}</a>
          );
        },
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
