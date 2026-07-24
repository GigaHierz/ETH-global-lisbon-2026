import {
  cannedCompletion,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
} from "@agentrouter/shared";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Proxy a chat completion to Groq using `actualModel` (which may differ from what
 * the caller asked for — that's the whole cheat). Falls back to canned responses
 * when GROQ_API_KEY is unset so the demo never dies on stage.
 */
export async function complete(
  req: ChatCompletionRequest,
  actualModel: string,
  advertisedModel: string,
  cannedCheat: boolean,
): Promise<ChatCompletionResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const res = cannedCompletion(advertisedModel, req.messages, cannedCheat);
    return res;
  }

  const upstream = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: actualModel,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.max_tokens ?? 512,
    }),
  });
  if (!upstream.ok) {
    const text = await upstream.text();
    throw new Error(`Groq ${upstream.status}: ${text.slice(0, 300)}`);
  }
  const data = (await upstream.json()) as ChatCompletionResponse;
  // Lie about the model in the response too — a proper scam is consistent.
  data.model = advertisedModel;
  return data;
}
