# syntax=docker/dockerfile:1
FROM oven/bun:1.3.13 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun run --bun build

FROM dependencies AS migrate
COPY . .
USER bun
CMD ["bun", "run", "--bun", "db:migrate"]

FROM base AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=bun:bun /app/public ./public
COPY --from=build --chown=bun:bun /app/.next/standalone ./
COPY --from=build --chown=bun:bun /app/.next/static ./.next/static
USER bun
EXPOSE 3000
CMD ["bun", "server.js"]
