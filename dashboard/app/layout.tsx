import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "AgentRouter — Inference Exchange",
  description: "On-chain OpenRouter: pay-per-request LLM inference over x402 + ERC-8004",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
