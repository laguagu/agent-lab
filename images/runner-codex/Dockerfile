# Runner for the codex-container track: OpenAI Codex, driven through @openai/codex-sdk.
#
# The build context is the repo root, because the image also needs packages/protocol.
#   docker build -f images/runner-codex/Dockerfile -t agent-lab-runner-codex:latest .
#
# The same two rules as runner-claude apply, for the same reasons:
#
# 1. npm, not bun. The SDK spawns the native codex binary, which ships as the optional
#    dependency @openai/codex-linux-x64 (an npm alias of @openai/codex).
#
# 2. No bundling. The SDK resolves the binary relative to its own package on disk.
#
# The SDK is pinned exactly: it drives `codex exec --experimental-json`, and the SDK and
# the binary it finds must come from the same release.

# --- build the shared protocol -------------------------------------------------
FROM node:24-bookworm-slim AS protocol
WORKDIR /build
COPY packages/protocol/package.json ./packages/protocol/
RUN cd packages/protocol && npm install --no-audit --no-fund
COPY packages/protocol ./packages/protocol
RUN cd packages/protocol && npx tsc -p tsconfig.build.json

# --- dependencies ---------------------------------------------------------------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY images/runner-codex/package.json ./
# The workspace:* protocol does not work with npm; swap it for a file: reference.
RUN sed -i 's|"@agent-lab/protocol": "workspace:\*"|"@agent-lab/protocol": "file:./vendor/protocol"|' package.json
COPY --from=protocol /build/packages/protocol/dist ./vendor/protocol/dist
COPY --from=protocol /build/packages/protocol/package.json ./vendor/protocol/
RUN npm install --omit=dev --no-audit --no-fund \
 && test -x node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex \
    || (echo "ERROR: native codex binary missing - check optionalDependencies" && exit 1)

# --- runtime ---------------------------------------------------------------------
FROM node:24-bookworm-slim

# git: Codex reads repo state and the diff view needs it. ripgrep: its search tool.
# ca-certificates: HTTPS to the model endpoint.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep ca-certificates curl less \
 && rm -rf /var/lib/apt/lists/*

ENV HOME=/home/node \
    WORKSPACE_DIR=/workspace \
    NODE_ENV=production \
    CODEX_HOME=/home/node/.codex

WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/vendor ./vendor
COPY --chown=node:node images/runner-codex/src ./src
COPY --chown=node:node images/runner-codex/entrypoint.sh /usr/local/bin/entrypoint.sh
# The binary on PATH too, so `codex` works from the terminal tab for debugging.
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && ln -s /app/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex /usr/local/bin/codex \
 && mkdir -p /workspace /home/node/.codex /home/node/.agents \
 && chown -R node:node /workspace /home/node

USER node
VOLUME ["/workspace", "/home/node/.codex"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "/app/src/index.ts"]
