# Runner: the container the agent and the skills run in.
#
# The build context is the repo root, because the image also needs packages/protocol.
#   docker build -f images/runner-claude/Dockerfile -t agent-lab-runner-claude:latest .
#
# TWO RULES THAT MUST NOT BE BROKEN:
#
# 1. npm, not bun. The Claude Agent SDK ships the native claude binary as an optional
#    dependency (@anthropic-ai/claude-agent-sdk-linux-x64). Bun installs neither it nor
#    the peer dependencies, and the run then dies with spawn ENOENT.
#
# 2. No bundling. Bundled, import.meta.url resolves to a virtual path where the SDK
#    cannot find cli.js. Run it as plain source with node_modules present.

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
COPY images/runner-claude/package.json ./
# The workspace:* protocol does not work with npm; swap it for a file: reference.
RUN sed -i 's|"@agent-lab/protocol": "workspace:\*"|"@agent-lab/protocol": "file:./vendor/protocol"|' package.json
COPY --from=protocol /build/packages/protocol/dist ./vendor/protocol/dist
COPY --from=protocol /build/packages/protocol/package.json ./vendor/protocol/
RUN npm install --omit=dev --no-audit --no-fund \
 && test -x node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude \
    || (echo "ERROR: native claude binary missing - check optionalDependencies" && exit 1)

# --- runtime ---------------------------------------------------------------------
FROM node:24-bookworm-slim

# git and ripgrep: Claude Code Bash and Grep tools expect them.
# ca-certificates: HTTPS to the model router.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep ca-certificates curl less \
 && rm -rf /var/lib/apt/lists/*

# The node image already has a node user at uid 1000 - use it, never root.
ENV HOME=/home/node \
    WORKSPACE_DIR=/workspace \
    NODE_ENV=production \
    CLAUDE_CODE_DISABLE_AUTO_MEMORY=1

WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# vendor/ must come along: npm installed @agent-lab/protocol as a file: reference, so
# the node_modules entry is a symlink here. Without this the link dangles.
COPY --from=deps --chown=node:node /app/vendor ./vendor
COPY --chown=node:node images/runner-claude/src ./src
COPY --chown=node:node images/runner-claude/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /workspace /home/node/.claude \
 && chown -R node:node /workspace /home/node

USER node
VOLUME ["/workspace", "/home/node/.claude"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "/app/src/index.ts"]
