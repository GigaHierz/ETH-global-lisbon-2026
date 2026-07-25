# Deterministic build for the AgentRouter Node services on Railway/any Docker host.
# One image for the whole pnpm workspace; each Railway service overrides the Start
# Command to pick which service it runs:
#   agent-server → pnpm agent-server:prod
#   exchange     → pnpm exchange:prod
#   provider     → pnpm provider:prod   (set PROVIDER_PROFILE=provider1|2|3)
#
# Env vars come from the host (Railway Variables), NOT a .env file. PORT is injected.

FROM node:22-slim

# git is handy for some transitive install scripts; corepack gives us the pinned pnpm.
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --no-frozen-lockfile

# Default; Railway's per-service Custom Start Command overrides this.
CMD ["pnpm", "agent-server:prod"]
