import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "AgentRouter — Inference Exchange",
  description: "On-chain OpenRouter: pay-per-request LLM inference over x402 (HBAR) + HCS-14 identity on Hedera",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
