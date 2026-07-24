# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3.14 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ARG NEXT_PUBLIC_API_BASE_URL=
ARG NEXT_PUBLIC_WS_BASE_URL=
ARG NEXT_PUBLIC_API_KEY=
ARG NEXT_PUBLIC_DEPLOYMENT_ENV=production
ARG BETTER_AUTH_SECRET=sk_better_auth_build_placeholder_min_32_chars
ARG BETTER_AUTH_URL=http://localhost
ARG BETTER_AUTH_DATABASE_URL=postgresql://smallkhoj:smallkhoj@localhost:5432/smallkhoj
ARG AUTH_BRIDGE_SECRET=sk_auth_bridge_build_placeholder_min_32_chars
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_WS_BASE_URL=$NEXT_PUBLIC_WS_BASE_URL
ENV NEXT_PUBLIC_DEPLOYMENT_ENV=$NEXT_PUBLIC_DEPLOYMENT_ENV
ENV BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
ENV BETTER_AUTH_URL=$BETTER_AUTH_URL
ENV BETTER_AUTH_DATABASE_URL=$BETTER_AUTH_DATABASE_URL
ENV AUTH_BRIDGE_SECRET=$AUTH_BRIDGE_SECRET
RUN --mount=type=secret,id=public_api_key \
    public_api_key=""; \
    if [ "$NEXT_PUBLIC_DEPLOYMENT_ENV" = "local-dev" ]; then \
      public_api_key="$NEXT_PUBLIC_API_KEY"; \
    elif [ -f /run/secrets/public_api_key ]; then \
      public_api_key="$(cat /run/secrets/public_api_key)"; \
    else \
      echo "PUBLIC_API_KEY BuildKit secret is required for production builds" >&2; \
      exit 1; \
    fi; \
    NEXT_PUBLIC_API_KEY="$public_api_key" bun run build

FROM oven/bun:1.3.14 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=bun:bun /app/public ./public
COPY --from=builder --chown=bun:bun /app/.next/standalone ./
COPY --from=builder --chown=bun:bun /app/.next/static ./.next/static
RUN mkdir -p /app/.next/cache && chown -R bun:bun /app
USER bun
EXPOSE 3000
CMD ["bun", "run", "server.js"]
