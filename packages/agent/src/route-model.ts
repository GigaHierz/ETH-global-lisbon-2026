// Model routing: pick which LLM a query should be bought from, based on the
// live provider market and simple prompt heuristics. The exchange still picks
// the cheapest provider FOR that model — this layer only decides the model tier,
// so a simple question never pays 70b prices and a hard one never gets a 3b.

export interface LiveModel {
  model: string;
  price: number; // cheapest live ask for this model (display units)
}

export interface ModelRoute {
  model: string;
  tier: "simple" | "medium" | "premium";
  reason: string;
}

const CODE_RE = /```|\b(function|class |def |import |const |bug|stack trace|refactor|regex|sql|typescript|python)\b/i;
const REASONING_RE = /\b(prove|proof|step[- ]by[- ]step|theorem|derive|logic puzzle|chain of thought)\b/i;
const SIMPLE_START_RE = /^(what|why|who|when|where|which|how|define|translate|is|are|does|can)\b/i;

/** Distinct live models sorted by their cheapest ask, ascending. */
export function liveModels(providers: Array<{ model: string; price: number; status: string }>): LiveModel[] {
  const cheapest = new Map<string, number>();
  for (const p of providers) {
    if (p.status !== "live") continue;
    const prev = cheapest.get(p.model);
    if (prev === undefined || p.price < prev) cheapest.set(p.model, p.price);
  }
  return [...cheapest.entries()]
    .map(([model, price]) => ({ model, price }))
    .sort((a, b) => a.price - b.price);
}

/**
 * Route a query to a model tier:
 * - reasoning/code/long prompts → premium (most expensive live model — capability proxy)
 * - short factual questions     → simple (cheapest live model)
 * - everything else             → medium (middle of the live price range)
 * Falls back to `fallbackModel` when the market is empty.
 */
export function routeModel(
  query: string,
  providers: Array<{ model: string; price: number; status: string }>,
  fallbackModel: string,
): ModelRoute {
  const models = liveModels(providers);
  if (models.length === 0) {
    return { model: fallbackModel, tier: "medium", reason: "no live providers — fallback model" };
  }
  const cheapest = models[0];
  const priciest = models[models.length - 1];
  const middle = models[Math.floor((models.length - 1) / 2)];

  const q = query.trim();
  if (REASONING_RE.test(q) || CODE_RE.test(q) || q.length > 600) {
    return { model: priciest.model, tier: "premium", reason: "reasoning/code/long prompt" };
  }
  if (q.length < 200 && (SIMPLE_START_RE.test(q) || q.endsWith("?"))) {
    return { model: cheapest.model, tier: "simple", reason: "short factual question" };
  }
  return { model: middle.model, tier: "medium", reason: "general prompt" };
}
