import React from "react";

type Name = "smtp" | "pop3" | "error" | "email" | "sms" | "logs" | "connections" |
  "footprint" | "documentation" | "api";
export function NavigationIcon({ name }: { name: Name }) {
  const shared = { width: 20, height: 20, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor", strokeWidth: 1.8,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true as const, className: "navIcon" };
  if (name === "smtp" || name === "pop3") return <svg {...shared}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="m3 8 9 6 9-6" />
    {name === "smtp" ? <path d="M18 3v6m-3-3 3-3 3 3"/> :
      <path d="M18 3v6m-3-3 3 3 3-3"/>}
  </svg>;
  if (name === "sms") return <svg {...shared}>
    <path d="M20 11a7 7 0 0 1-7 7H7l-4 3v-5a7 7 0 1 1 17-5Z"/>
    <path d="M7 9h10M7 12h7"/>
  </svg>;
  if (name === "error") return <svg {...shared}>
    <path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5m0 3h.01"/>
  </svg>;
  if (name === "logs") return <svg {...shared}>
    <path d="M4 5h16M4 12h16M4 19h16"/><path d="M2 5h.01M2 12h.01M2 19h.01"/>
  </svg>;
  if (name === "footprint") return <svg {...shared}>
    <path d="M2 19h20M4 15V9M9 15V5M14 15v-8M19 15V3"/>
  </svg>;
  if (name === "connections") return <svg {...shared}>
    <path d="M8 4v5m8-5v5M5 9h14v4a7 7 0 0 1-14 0V9Zm7 11v2"/>
  </svg>;
  if (name === "api") return <svg {...shared}>
    <path d="m9 6-6 6 6 6m6-12 6 6-6 6m-3-14-4 16"/>
  </svg>;
  if (name === "documentation") return <svg {...shared}>
    <path d="M3 5a2 2 0 0 1 2-2h7v18H5a2 2 0 0 0-2 2V5Zm18 0a2 2 0 0 0-2-2h-7v18h7a2 2 0 0 1 2 2V5Z"/>
  </svg>;
  return <svg {...shared}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 8 9 6 9-6"/></svg>;
}
