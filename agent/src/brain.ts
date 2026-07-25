// The agent's own reasoning, run on Groq directly (decoupled from the inference
// it BUYS). The brain only decides *what* to ask and *how* to combine answers;
// the answers themselves are purchased through the exchange over x402. This keeps
// the demo-critical payment path independent of the agent's private reasoning.

import type { Brain, Finding } from "./loop.js";
import { log } from "@agentrouter/shared";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const BRAIN_MODEL = process.env.AGENT_BRAIN_MODEL || "llama-3.3-70b-versatile";

async function groqChat(system: string, user: string, temperature = 0.3): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY unset — the agent brain needs it to reason");
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: BRAIN_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: 512,
    }),
  });
  if (!res.ok) throw new Error(`Groq brain ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

const MAX_QUESTIONS = parseInt(process.env.AGENT_MAX_QUESTIONS || "3", 10);

export const groqBrain: Brain = {
  async plan(goal: string): Promise<string[]> {
    // No key → degrade to treating the goal itself as the single question, so the
    // agent still buys at least one inference and the payment flow is exercised.
    if (!process.env.GROQ_API_KEY) return [goal];
    const raw = await groqChat(
      `You are an autonomous research agent that buys LLM inference per question to accomplish a goal. ` +
        `Break the user's goal into at most ${MAX_QUESTIONS} focused, self-contained sub-questions, each answerable by a single LLM call. ` +
        `Reply with ONLY a JSON array of strings, no prose.`,
      goal,
    );
    const questions = parseJsonArray(raw);
    if (questions.length === 0) {
      log("agent", `brain: plan parse fell back to single question`);
      return [goal];
    }
    return questions.slice(0, MAX_QUESTIONS);
  },

  async synthesize(goal: string, findings: Finding[]): Promise<string> {
    if (findings.length === 0) return "(no answers were purchased — budget exhausted before any buy)";
    if (!process.env.GROQ_API_KEY) return findings.map((f) => f.a).join("\n\n");
    const context = findings.map((f, i) => `Q${i + 1}: ${f.q}\nA${i + 1}: ${f.a}`).join("\n\n");
    return groqChat(
      `You are an autonomous research agent. Using ONLY the purchased answers below, write a concise, well-structured response to the goal. ` +
        `Do not invent facts beyond the answers.`,
      `GOAL: ${goal}\n\nPURCHASED ANSWERS:\n${context}`,
    );
  },
};

/** Best-effort parse of a JSON string array, tolerating code fences / stray prose. */
function parseJsonArray(raw: string): string[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
  } catch {
    return [];
  }
}
