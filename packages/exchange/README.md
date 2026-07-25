# @agentrouter/exchange

Routing + settlement core: discovers providers from the HCS registry, routes each request to
the cheapest live provider claiming the model, pays the winner via x402, and publishes every
trade to HCS. Streams events to the dashboard over SSE.

Full documentation: [`docs/exchange.md`](../../docs/exchange.md).
