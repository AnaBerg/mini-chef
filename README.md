# Mini Chef

Next.js App Router with TypeScript, Bun, shadcn/ui (preset `beqDGaVU`), PostgreSQL 18, Drizzle ORM, and Better Auth email/password authentication. Bun manages dependencies and scripts; Next.js and the test tools run on Node.js 24, including inside Docker. Vitest covers automated unit tests; Playwright covers end-to-end flows.

## Local development

Install Node.js 24.15 or newer in the 24.x release line, Bun 1.3.13, and Docker with the Compose plugin, then run:

```sh
cp .env.example .env
bun install --frozen-lockfile
openssl rand -hex 32
```

Replace `BETTER_AUTH_SECRET` in `.env` with the generated value. Start the database, apply the committed migrations, and run Next.js:

```sh
docker compose up -d db
bun run db:migrate
bun run dev
```

Open <http://localhost:3000>. Keep `BETTER_AUTH_URL` aligned with the URL used in your browser. `.env.example` credentials and the placeholder secret are intended for local development only. If you change the database credentials or port, also update `DATABASE_URL` in `.env`. Compose automatically uses the internal database hostname for its application containers.

## Run everything in Docker

After creating `.env` and replacing its secret:

```sh
docker compose up --build -d
```

Compose starts PostgreSQL, waits for its health check, runs Drizzle migrations once, and starts the application on <http://localhost:3000>. The multi-stage application image runs the Next.js standalone output as a non-root user. Database credentials and the authentication secret are supplied at runtime; the image build requires no secrets or live database.

```sh
docker compose logs -f web
docker compose down
```

The database persists in the `postgres_data` volume. Both published ports bind to localhost. PostgreSQL 18 stores its versioned data beneath `/var/lib/postgresql`, which is the volume mount used here. After changing the schema, generate and commit a migration, then rebuild and restart Compose to apply it.

## Database changes

```sh
bun run db:generate
bun run db:migrate
bun run db:studio
```

Review and commit the generated SQL and migration metadata in `drizzle/` alongside schema changes. `db:migrate` applies pending migrations to `DATABASE_URL`; do not use a production database for tests.

## Checks

```sh
bun run lint
bun run typecheck
bun run test
bun run build
bunx playwright install chromium
bun run test:e2e
```

End-to-end tests require a running PostgreSQL database with migrations applied. Playwright manages the application server. GitHub Actions runs lint, TypeScript checks, Vitest, and the production build; a separate job runs Playwright against PostgreSQL and the production server. Failed E2E runs upload the Playwright report and test artifacts.

## Scripts

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the development server |
| `bun run build` | Create a production build |
| `bun run start` | Start the production server after building |
| `bun run lint` | Run ESLint |
| `bun run typecheck` | Check TypeScript types |
| `bun run test` | Run Vitest once |
| `bun run test:e2e` | Run Playwright |
| `bun run db:generate` | Generate Drizzle migrations |
| `bun run db:migrate` | Apply committed migrations |
| `bun run db:studio` | Open Drizzle Studio |
