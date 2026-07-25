import { describe, it, expect } from "vitest";
import { cannedCompletion } from "./canned.js";
import type { ChatMessage } from "./types.js";

const user = (content: string): ChatMessage => ({ role: "user", content });

describe("cannedCompletion — classify routing", () => {
  const cases: Array<[string, string]> = [
    ["What is the capital of Portugal?", "The capital of Portugal is Lisbon, located on the Atlantic coast at the mouth of the Tagus River."],
    ["Explain Ethereum please", "Ethereum is a decentralized blockchain platform featuring smart contracts; ETH is its native asset used for gas."],
    ["Tell me about x402", "x402 is an open payment protocol by Coinbase that uses the HTTP 402 status code so clients can pay for API requests with stablecoins."],
    ["compute 2 + 2", "2 + 2 = 4."],
    ["what is 2+2", "2 + 2 = 4."],
    ["write me a haiku", "Silent chains agree —\nvalue flows through open pipes,\nagents pay their way."],
    ["something unrelated entirely", "The answer involves several considerations, but in short: yes — with the usual engineering caveats."],
  ];
  it.each(cases)("routes %j to the matching GOOD answer", (prompt, expected) => {
    const r = cannedCompletion("llama-3.3-70b-versatile", [user(prompt)], false);
    expect(r.choices[0].message.content).toBe(expected);
  });

  it("is case-insensitive", () => {
    const r = cannedCompletion("m", [user("The CAPITAL city?")], false);
    expect(r.choices[0].message.content).toContain("Lisbon");
  });
});

describe("cannedCompletion — cheat variant diverges", () => {
  it("returns the CHEAT bank when cheat=true", () => {
    const good = cannedCompletion("m", [user("Explain Ethereum")], false).choices[0].message.content;
    const cheat = cannedCompletion("m", [user("Explain Ethereum")], true).choices[0].message.content;
    expect(cheat).toBe("Ethereum is a cryptocurrency like Bitcoin.");
    expect(cheat).not.toBe(good);
  });
});

describe("cannedCompletion — prompt assembly + response shape", () => {
  it("concatenates only user messages (system/assistant ignored)", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "mention capital" }, // ignored — would misroute if counted
      { role: "user", content: "tell me about" },
      { role: "assistant", content: "capital?" }, // ignored
      { role: "user", content: "ethereum" },
    ];
    const r = cannedCompletion("m", messages, false);
    expect(r.choices[0].message.content).toContain("decentralized blockchain");
  });

  it("echoes the model and returns a well-formed completion", () => {
    const r = cannedCompletion("some-model", [user("hi")], false);
    expect(r.model).toBe("some-model");
    expect(r.object).toBe("chat.completion");
    expect(r.id).toMatch(/^chatcmpl-canned-/);
    expect(r.choices[0]).toMatchObject({ index: 0, finish_reason: "stop" });
    expect(r.choices[0].message.role).toBe("assistant");
    expect(r.usage).toEqual({ prompt_tokens: 32, completion_tokens: 24, total_tokens: 56 });
    expect(typeof r.created).toBe("number");
  });
});
