// Backend dispatch: where a provider's compute actually comes from.
// Default for bring-your-own providers is the 0G Compute decentralized GPU
// network; the named demo profiles pin their backend explicitly (p1-p3 = groq,
// deterministic — the verifier's slash arc depends on it).

import type { ChatCompletionRequest, ChatCompletionResponse } from "@agentrouter/shared";
import { cannedCompletion } from "@agentrouter/shared";
import { complete as groqComplete } from "./groq.js";
import { complete as zerogComplete } from "./zerog.js";

export type ProviderBackend = "0g" | "groq" | "canned";

export const DEFAULT_BACKEND: ProviderBackend = "0g";

export function complete(
  backend: ProviderBackend,
  req: ChatCompletionRequest,
  actualModel: string,
  advertisedModel: string,
  cannedCheat: boolean,
): Promise<ChatCompletionResponse> {
  switch (backend) {
    case "0g":
      return zerogComplete(req, actualModel, advertisedModel, cannedCheat);
    case "groq":
      return groqComplete(req, actualModel, advertisedModel, cannedCheat);
    case "canned":
      return Promise.resolve({ ...cannedCompletion(advertisedModel, req.messages, cannedCheat), servedBy: "canned" as const });
  }
}
