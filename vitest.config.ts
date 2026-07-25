import { defineConfig } from "vitest/config";

// Root aggregate run: every package's unit tests in one pass, with one coverage
// report. `pnpm test` runs this; `pnpm test:coverage` adds the coverage gate.
//
// Coverage is scoped to the pure logic surface (the "logic modules"). I/O-heavy
// code — HTTP servers, entrypoints (index.ts), network/x402/chain calls, the LLM
// brain, and the Next.js dashboard UI — is out of scope by design and left out of
// the include list (network branches inside otherwise-pure modules are marked with
// `/* v8 ignore */`). That surface is exercised by `pnpm demo` end-to-end instead.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "packages/shared/src/canned.ts",
        "packages/shared/src/constants.ts",
        "packages/shared/src/hedera.ts",
        "packages/shared/src/hcs.ts",
        "packages/exchange/src/state.ts",
        "packages/exchange/src/discovery.ts",
        "packages/exchange/src/slash.ts",
        "packages/provider/src/profiles.ts",
        "packages/agent/src/budget.ts",
        "packages/agent/src/buy.ts",
        "packages/agent/src/identity.ts",
        "packages/agent/src/loop.ts",
        "packages/verifier/src/similarity.ts",
        "packages/verifier/src/audit-selection.ts",
        "packages/verifier/src/verification.ts",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 95,
      },
    },
  },
});
