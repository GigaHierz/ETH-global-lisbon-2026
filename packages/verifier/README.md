# @agentrouter/verifier

Fraud auditor: samples routed traffic, replays sampled prompts at temperature 0 against an
honest same-model witness, and slashes the staked HBAR of providers whose answers diverge
(serving a cheaper model than advertised). Publishes verdicts to HCS.

Full documentation: [`docs/verifier.md`](../../docs/verifier.md).
