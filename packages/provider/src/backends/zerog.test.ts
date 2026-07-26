import { describe, it, expect } from "vitest";
import type { ChatCompletionResponse } from "@agentrouter/shared";
import { salvageThinkingAnswer } from "./zerog.js";

function resp(message: Record<string, unknown>): ChatCompletionResponse {
  return {
    id: "x",
    object: "chat.completion",
    created: 0,
    model: "0gm-1.0-35b-a3b",
    choices: [{ index: 0, message: message as never, finish_reason: "stop" }],
  };
}

describe("salvageThinkingAnswer", () => {
  it("keeps a normal answer untouched", () => {
    const data = resp({ role: "assistant", content: "the answer" });
    expect(salvageThinkingAnswer(data)).toBe(true);
    expect(data.choices[0].message.content).toBe("the answer");
  });

  it("promotes reasoning_content when content is empty (thinking model)", () => {
    const data = resp({ role: "assistant", content: "", reasoning_content: "salvaged answer" });
    expect(salvageThinkingAnswer(data)).toBe(true);
    expect(data.choices[0].message.content).toBe("salvaged answer");
  });

  it("prefers a present content over reasoning_content", () => {
    const data = resp({ role: "assistant", content: "real", reasoning_content: "thoughts" });
    expect(salvageThinkingAnswer(data)).toBe(true);
    expect(data.choices[0].message.content).toBe("real");
  });

  it("reports false when neither content nor reasoning_content is usable", () => {
    const data = resp({ role: "assistant", content: "" });
    expect(salvageThinkingAnswer(data)).toBe(false);
    expect(data.choices[0].message.content).toBe("");
  });

  it("reports false when there are no choices", () => {
    const data = resp({ role: "assistant", content: "x" });
    data.choices = [];
    expect(salvageThinkingAnswer(data)).toBe(false);
  });
});
