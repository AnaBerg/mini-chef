# Household persistence and command contract

This foundation implements F01 (#4). Household creation/settings UI, invitations,
selection, dietary versions and domain feature tables belong to their own issues.
Better Auth's `user`, `session`, `account`, and `verification` tables remain intact.

## Persistence conventions

- Domain IDs are UUIDs. Authentication user IDs remain text. Every member references
  a real account; `(household_id, user_id)` is unique. All active members have equal
  domain permissions. Deactivate a membership; do not delete its identity or history.
- Household roots reference `households.id`. Every referenced tenant table exposes
  `UNIQUE (household_id, id)`; children use composite household/reference foreign keys
  with `ON DELETE RESTRICT`. A UUID alone is never proof of access. Generic audit
  `entity_id` is a historical identifier, not a polymorphic foreign key; actor and
  operation references are concrete composite foreign keys.
- Mutable roots have `created_at`, `updated_at`, and a positive integer `version`.
  Handlers compare the submitted expected version under lock, then increment it and
  update `updated_at` in the same transaction. Conflict means reload and obtain a new
  confirmation; never silently overwrite. Dietary versions arrive with F06 and are
  independent of membership status versions.
- Future canonical quantities use Drizzle `numeric(name, { precision: 18, scale: 6 })`
  and string values, never the number mode or JavaScript floating point arithmetic.
  Canonical units are `g`, `ml`, and `each`; conversion and exact arithmetic are owned
  by the food/stock slices. Validate scale before persistence: PostgreSQL otherwise
  rounds fractional digits beyond six. No dummy quantity or feature tables are added.
- Instants use `timestamptz`; calendar expiry uses `date` interpreted in the household
  timezone. Never derive household dates from the server's timezone. Household zones
  are supported IANA names or `UTC`, validated by `validateTimezone` and a database
  trigger against PostgreSQL's timezone catalog. Ambiguous abbreviations are rejected.
- Future referenced ingredients/recipes get nullable `archived_at` timestamps and
  remain queryable through history; archival does not cascade deletion. Operations
  and audit are historical records, never general editable resources. Corrections
  append new operations. Feature-specific source FKs arrive with their owning tables.

## Server boundary and authorization

Use `getDomainExecutor()` only in server code. It resolves the current Better Auth
session from request headers; neither a body user ID nor a membership ID establishes
identity. The kernel rechecks the backing session row, its user and expiry after
acquiring the household/member locks and immediately before returning to commit.
Its session `FOR SHARE` lock prevents concurrent revocation from committing during
an authorized command. A revocation that wins first prevents the command.

`createDomainExecutor(db, resolveSession)` is the server-only dependency injection
boundary for integration tests and trusted server adapters. Never expose the resolver,
handler callback, kind, or arbitrary database expressions as a client API. A feature
server action owns its fixed command kind, validation and implementation.

Every read uses `executor.read(householdId, callback)` and includes the context's
`householdId` in every tenant predicate and join. Reads hold household and membership
`FOR SHARE` through their callback, yielding a coherent view against household commands.
`readMember` demonstrates scoped ID lookup: a foreign ID returns `NOT_FOUND`. Missing,
foreign and inactive household access receive the same `ACCESS_DENIED` outcome.
The transaction context is trusted server code, not a row-level-security sandbox;
new handlers must follow scoped predicates even though composite FKs also protect links.

## Transaction and idempotency protocol

1. Resolve the authenticated session.
2. Begin a transaction and lock `households FOR UPDATE` by household ID.
3. Lock the actor membership `FOR SHARE` and verify active status. `FOR KEY SHARE`
   is insufficient because it permits a non-key status update.
4. Validate and lock the backing auth session. Authorization failures occur before
   replay, so historical idempotency results cannot restore inactive access.
5. Look up `(household_id, idempotency_key)`. The SHA-256 request hash covers the
   fixed command kind, authenticated actor membership, and canonical JSON input.
   JSON object key order is irrelevant; array order and values are significant.
   The same key with different input, kind or actor raises `IDEMPOTENCY_CONFLICT`.
6. If committed, replay the stored JSON result without executing the handler. Otherwise
   insert a provisional operation with a generated ID and an empty result inside the
   transaction. This allows the handler's feature records/audit to reference its ID.
7. Lock existing downstream rows in stable table-name order and ascending UUID order
   within each table, after the household/actor locks. Every feature uses this same
   order; lock all needed rows before changes. Check submitted optimistic versions.
8. Apply all domain changes and feature audit records in the same transaction. Replace
   the provisional operation result with the canonical JSON result, add a command
   audit summary, check session validity again, and commit. Never do network calls or
   external side effects in the handler; database rollback cannot undo them.

The household lock serializes duplicate requests before operation lookup. A losing
concurrent identical request reads the winner's committed result; a failed winner
leaves no operation/domain/audit writes and a subsequent request may execute. Result
JSON must be plain JSON: dates, undefined values and non-finite numbers are rejected.
Handlers must include every semantic input in `input`, including expected versions.
Return stable JSON-safe identifiers/values, using ISO strings for timestamp results.

`deactivateMember` follows the same protocol, locks the scoped target member, compares
its version, and records before/after status and version. A command that wins the
household lock may finish before deactivation; one queued after deactivation cannot
write. Self-deactivation is valid unless this is the last active member; subsequent normal
commands/replays are denied.

Audit summaries contain only kind and IDs. Feature audit payloads must be explicitly
constructed from permitted domain fields: never copy whole request/session objects,
passwords, cookies, auth tokens or invitation links into `before_data`/`after_data`.

## Narrow bootstrap exceptions (implemented by F02/F04)

Household creation has no existing actor membership. Authenticate first, validate name,
timezone and user-scoped idempotency input, then atomically create household, creator
membership and settings (default horizon seven; inclusion explicitly chosen). Record
operation/audit after the actor exists. Insert the non-null user/key creation-result
record last. On unique-key conflict, roll back all provisional writes, re-read the
winner and compare hashes. An identical replay never recreates membership; verify
current active access before selecting the household. No owner privilege is added.

Invitation acceptance authorizes only joining via authenticated explicit consent and
possession of a valid bearer token. Store only its hash. Lock household, creator
membership and invitation in the shared order. For a fresh acceptance validate expiry,
revocation and active creator, create/reactivate the unique recipient membership,
then write operation/audit and consume once. Check accepted state before fresh expiry
or creator validation: same-account retries return historical outcome plus current
membership and never reactivate; other-account reuse fails. A new invitation is needed
for a deactivated member. Normal invitation creation/revocation uses the executor.

## Migrations and verification

`0000` remains the authentication migration. `0001` adds only the five foundation
entities and timezone trigger. Drizzle's generated snapshot intentionally describes
schema objects; the custom timezone trigger lives in the SQL migration and must be
preserved in future migrations. Run `bun run db:migrate` against the application DB.

Run the integration suite against a dedicated PostgreSQL 18 instance whose test role
can create/drop databases:

```sh
DOMAIN_TEST_DATABASE_URL=postgres://user:password@localhost:5432/test_admin bun run test:integration
DOMAIN_TEST_DATABASE_URL=postgres://user:password@localhost:5432/test_admin bun run test:coverage
bun run lint
bun run typecheck
```

Tests create uniquely named disposable databases and clean them up; they never truncate
the database named in the URL. They run the actual migrations from empty and populated
auth-only states, verify replay/rollback/scoped access/FKs/optimistic conflicts, and
observe PostgreSQL lock waits for duplicate and authorization/deactivation races.
Without the URL, local integration tests are explicitly skipped. CI requires it and
provisions PostgreSQL for coverage; missing configuration fails instead of silently
skipping acceptance tests.

## Household creation and membership (F02)

`/households` lists current active memberships and provides household creation. The
client chooses planned-meal inclusion explicitly and submits a UUID request key.
Names are trimmed and limited to 100 characters; supported IANA names are normalized
through Intl before persistence and checked against PostgreSQL's catalog. Ambiguous
abbreviations and `posix/` or `right/` trees are rejected. `0002` adds the user-scoped
creation requests and strengthens the timezone trigger without changing auth tables.

`createHouseholdService` derives identity through the trusted server session resolver.
Creation writes household, real creator membership, seven-day shopping settings,
operation and audit in one transaction, then inserts the non-null creation result
last. The user/key unique constraint settles concurrent requests. A loser rolls back
its provisional records before reading and hash-checking the winner. Session validity
is rechecked after the potentially blocking result insert. A replay returns the
historical household ID only; the server action separately checks current active
access before navigation, and never reactivates membership.

`/households/[householdId]` shows all membership identities, including inactive ones.
Every active member can deactivate any member, including themselves, with explicit
confirmation. The last active member cannot be deactivated: another real account must
join first. The same guard runs under the household command lock, preventing two
concurrent removals from orphaning a household. Version conflicts require a page reload
and renewed confirmation. Deactivation preserves identity, audit and operations; it
removes authorization immediately for later commands and reads. Reactivation/joining
requires the invitation flow owned by F04; this slice exposes no accountless-member or
arbitrary membership insertion endpoint. Persistent household selection belongs to F03.

The F02 integration suite uses a PostgreSQL advisory-lock barrier to force concurrent
creation requests past preflight before inserting their competing results. It checks
matching/changed-content races, rollback, timezone normalization, last-active refusal,
equal permissions, version conflicts, preserved history and removed access. UI tests
cover explicit settings, stable retry keys and confirmation/conflict behavior. The
browser test creates two real auth accounts and seeds only their membership relationship
until F04 provides invitations, then verifies deactivation and denied access end to end.
