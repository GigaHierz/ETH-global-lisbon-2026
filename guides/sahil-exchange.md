# Sahil — EXCHANGE + DASHBOARD

## Exchange architecture ([exchange/src](../exchange/src))

| File | Job |
|---|---|
| `index.ts` | Express app: `POST /v1/chat/completions` (route→pay→respond), `GET /providers`, `GET /log`, `GET /events` (SSE), `POST /slash`, `POST /verify-report` |
| `discovery.ts` | Provider discovery: polls each `PROVIDER_URLS` entry's `/info` + liveness; step 3 adds the HCS registry topic via Mirror Node as the source of truth (merged with `/info`, `.registry-cache.json` as fallback) |
| `payer.ts` | The paying fetch: mock header ledger in mock mode; `@x402/fetch` + `@x402/hedera` signer (`HEDERA_EXCHANGE_ID/KEY`) in real mode |
| `state.ts` | In-memory: request log, provider table (reputation, stakeHbar, slashed flag), price index series, SSE broadcast |

**Routing:** filter live providers claiming the requested model, drop slashed ones, sort by `priceHbar` ascending, take head. No fee in the MVP (exchange-as-taker; fee = future work).

**Request lifecycle:** agent POST → pick provider → `paidPost()` (x402) → provider responds → log entry appended + SSE `request` event + price-index point → response returned with `agentrouter{provider, pricePaidHbar, latencyMs, paymentRef}` merged in. Step 3 adds: publish the same entry to the HCS trades topic (fire-and-forget, never blocks the response).

**Slash path:** verifier `POST /slash {wallet, amountHbar, reason}` → provider row: `slashed=true`, `stakeHbar -= amount`, `reputation=0` → SSE `slashed` event → router skips it from the next request on.

## SSE events (`GET /events`)

| type | payload | consumer |
|---|---|---|
| `snapshot` | full provider table + recent log | dashboard on connect |
| `request` | one log entry (provider, model, priceHbar, latencyMs, status, paymentRef) | feed + price chart |
| `providers` | refreshed provider table | table |
| `slashed` | `{provider, amountHbar, reason}` | red banner |
| `verify` | verifier report (similarity, verdict) | verifier panel |

## Dashboard ([dashboard/app/page.tsx](../dashboard/app/page.tsx))

Single-page Next.js client component, dark terminal aesthetic. Connects to `EXCHANGE_URL/events` (SSE) — no polling except the audit panel.

| Panel | Data source |
|---|---|
| Provider table (name, model, ℏ/req, stake, reputation, status) | `snapshot` + `providers` events |
| Live request feed | `request` events |
| Price index chart (per-model avg, recharts) | `request` events bucketed client-side |
| SLASHED banner | `slashed` event (full-width, flashing) |
| Verifier panel | `verify` events |
| **Audit trail (live)** | **Mirror Node REST directly**: `GET https://testnet.mirrornode.hedera.com/api/v1/topics/{topicId}/messages?order=desc&limit=25`, decode `message` from base64, JSON.parse; poll every 5s (mirror lag 1-5s); header links the topic on Hashscan |

## Dev loop for UI changes

```bash
pnpm dashboard        # next dev, HMR on :3000
pnpm demo             # separate terminal: generates live events
```

Mock mode is enough for all UI work — the SSE contract is identical. Recharts + Tailwind already in `dashboard/package.json`. The SSE hook and event types are at the top of `page.tsx`; shared payload types in [shared/src/types.ts](../shared/src/types.ts) (`ExchangeEvent`).

## Gotchas

- Provider table state lives in the **exchange**, not the dashboard — restart the exchange and reputation/slashes reset (in-memory by design).
- `.registry-cache.json` persists provider registration ids across runs — `rm` it for a clean demo.
- The price chart buckets client-side; if you add models, colors come from the model-name hash — no config needed.
