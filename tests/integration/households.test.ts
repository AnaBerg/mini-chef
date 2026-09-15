// @vitest-environment node
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createDomainExecutor, deactivateMember, type DomainDatabase } from "@/lib/domain/commands";
import { createHouseholdService, householdDetails } from "@/lib/domain/households";

vi.mock("server-only", () => ({}));
const databaseUrl = process.env.DOMAIN_TEST_DATABASE_URL;
if (process.env.CI && !databaseUrl) throw new Error("DOMAIN_TEST_DATABASE_URL is required in CI.");

describe.skipIf(!databaseUrl)("household creation and membership", () => {
  let admin: ReturnType<typeof postgres>;
  let client: ReturnType<typeof postgres>;
  let db: DomainDatabase;
  let databaseName: string;
  const identity = { id: "creator-session", userId: "creator" };
  let service: ReturnType<typeof createHouseholdService>;
  let executor: ReturnType<typeof createDomainExecutor>;
  const input = () => ({ name: "Our kitchen", timezone: "america/sao_paulo", includePlannedMeals: false, idempotencyKey: randomUUID() });
  beforeAll(async () => {
    admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    databaseName = `households_test_${randomUUID().replaceAll("-", "")}`;
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(databaseUrl!); url.pathname = `/${databaseName}`;
    client = postgres(url.toString(), { max: 10, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    service = createHouseholdService(db, async () => identity);
    executor = createDomainExecutor(db, async () => identity);
  });
  afterAll(async () => {
    await client?.end();
    if (databaseName) await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin?.end();
  });
  beforeEach(async () => {
    await client`TRUNCATE households, "user" CASCADE`;
    await db.insert(schema.user).values([{ id: "creator", name: "Creator", email: "creator@example.test" }, { id: "peer", name: "Peer", email: "peer@example.test" }]);
    await db.insert(schema.session).values([{ id: identity.id, userId: identity.userId, token: randomUUID(), expiresAt: new Date(Date.now() + 3600_000) }, { id: "peer-session", userId: "peer", token: randomUUID(), expiresAt: new Date(Date.now() + 3600_000) }]);
  });
  it("creates the household, real creator, explicit settings and history atomically and replays", async () => {
    const request = input();
    const result = await service.create(request);
    expect(await service.create(request)).toEqual(result);
    expect(await service.list()).toEqual([{ id: result.householdId, name: request.name }]);
    expect((await db.select().from(schema.households))[0].timezone).toBe("America/Sao_Paulo");
    expect(await db.select().from(schema.shoppingSettings)).toEqual([expect.objectContaining({ planningHorizonDays: 7, includePlannedMeals: false })]);
    expect(await db.select().from(schema.householdMembers)).toEqual([expect.objectContaining({ userId: "creator", status: "active" })]);
    expect(await db.select().from(schema.auditEvents)).toHaveLength(1);
    expect(await db.select().from(schema.domainOperations)).toHaveLength(1);
    await expect(service.create({ ...request, name: "Different" })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect(await db.select().from(schema.households)).toHaveLength(1);
  });
  it("rolls back unique-key losers for concurrent matching and changed-content requests", async () => {
    // Hold both provisional results at a database barrier before permitting the unique insert.
    await client`CREATE FUNCTION delay_creation_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock_shared(515); RETURN NEW; END $$`;
    async function race(first: ReturnType<typeof input>, second: ReturnType<typeof input>) {
      let ready!: () => void; let release!: () => void;
      const locked = new Promise<void>((resolve) => { ready = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      const barrier = client.begin(async (tx) => { await tx`SELECT pg_advisory_xact_lock(515)`; ready(); await released; });
      await locked;
      const results = Promise.allSettled([service.create(first), service.create(second)]);
      try {
        let blocked = false;
        for (let attempt = 0; attempt < 150; attempt++) {
          const [state] = await client`SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = ${databaseName} AND wait_event = 'advisory'`;
          if (state.count === 2) { blocked = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
      } finally { release(); await barrier; }
      return results;
    }
    await client`CREATE TRIGGER delay_result BEFORE INSERT ON household_creation_requests FOR EACH ROW EXECUTE FUNCTION delay_creation_result()`;
    try {
      const request = input();
      const results = await race(request, request);
      expect(results[0].status).toBe("fulfilled");
      expect(results[0]).toEqual(results[1]);
      const changed = input();
      const outcomes = await race(changed, { ...changed, includePlannedMeals: true });
      expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.find((item) => item.status === "rejected")).toMatchObject({ reason: { code: "IDEMPOTENCY_CONFLICT" } });
      for (const table of [schema.households, schema.householdMembers, schema.shoppingSettings, schema.domainOperations, schema.auditEvents, schema.householdCreationRequests]) expect(await db.select().from(table)).toHaveLength(2);
    } finally { await client`DROP TRIGGER delay_result ON household_creation_requests`; await client`DROP FUNCTION delay_creation_result()`; }
  });
  it("rolls back all bootstrap writes when a downstream write fails", async () => {
    await client`CREATE FUNCTION reject_creation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$`;
    await client`CREATE TRIGGER reject_creation BEFORE INSERT ON household_creation_requests FOR EACH ROW EXECUTE FUNCTION reject_creation()`;
    try { await expect(service.create(input())).rejects.toThrow(); }
    finally { await client`DROP TRIGGER reject_creation ON household_creation_requests`; await client`DROP FUNCTION reject_creation()`; }
    for (const table of [schema.households, schema.householdMembers, schema.shoppingSettings, schema.domainOperations, schema.auditEvents, schema.householdCreationRequests]) expect(await db.select().from(table)).toHaveLength(0);
  });
  it("preserves history, equal permissions and removed access without reactivation on creation retry", async () => {
    const request = input();
    const { householdId } = await service.create(request);
    const initial = await householdDetails(executor, householdId);
    await expect(deactivateMember(executor, { householdId, memberId: initial.actorMemberId, expectedVersion: 1, idempotencyKey: randomUUID() })).rejects.toThrow("LAST_ACTIVE_MEMBER");
    const [peer] = await db.insert(schema.householdMembers).values({ householdId, userId: "peer" }).returning();
    const peerExecutor = createDomainExecutor(db, async () => ({ id: "peer-session", userId: "peer" }));
    const removal = { householdId, memberId: initial.actorMemberId, expectedVersion: 1, idempotencyKey: randomUUID() };
    await deactivateMember(peerExecutor, removal);
    expect(await service.create(request)).toEqual({ householdId });
    expect(await service.list()).toEqual([]);
    await expect(householdDetails(executor, householdId)).rejects.toThrow("ACCESS_DENIED");
    await expect(deactivateMember(executor, { ...removal, memberId: peer.id })).rejects.toThrow("ACCESS_DENIED");
    const details = await householdDetails(peerExecutor, householdId);
    expect(details.members.find((member) => member.id === initial.actorMemberId)).toMatchObject({ status: "inactive", version: 2 });
    expect(await db.select().from(schema.auditEvents)).toHaveLength(3);
    await expect(deactivateMember(peerExecutor, { ...removal, idempotencyKey: randomUUID() })).rejects.toThrow("VERSION_CONFLICT");
    await expect(db.insert(schema.householdMembers).values({ householdId, userId: "no-account" })).rejects.toThrow();
    await expect(db.delete(schema.householdMembers).where(eq(schema.householdMembers.id, initial.actorMemberId))).rejects.toThrow();
  });
  it("keeps already-inactive membership unchanged for a fresh request while preserving command replay", async () => {
    const { householdId } = await service.create(input());
    const [peer] = await db.insert(schema.householdMembers).values({ householdId, userId: "peer" }).returning();
    const removal = { householdId, memberId: peer.id, expectedVersion: 1, idempotencyKey: randomUUID() };
    const result = await deactivateMember(executor, removal);
    const [before] = await db.select().from(schema.householdMembers).where(eq(schema.householdMembers.id, peer.id));
    const membershipAudit = () => db.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityType, "household_member"));
    const beforeAudit = await membershipAudit();
    const fresh = { ...removal, expectedVersion: result.version, idempotencyKey: randomUUID() };
    expect(await deactivateMember(executor, fresh)).toEqual(result);
    const [after] = await db.select().from(schema.householdMembers).where(eq(schema.householdMembers.id, peer.id));
    expect(after).toEqual(before);
    expect(await membershipAudit()).toEqual(beforeAudit);
    // The accepted no-op still has its own operation and generic command summary.
    expect(await db.select().from(schema.domainOperations)).toHaveLength(3);
    expect(await db.select().from(schema.auditEvents)).toHaveLength(4);
    expect(await deactivateMember(executor, removal)).toEqual(result);
    expect(await deactivateMember(executor, fresh)).toEqual(result);
    expect(await db.select().from(schema.domainOperations)).toHaveLength(3);
    expect(await db.select().from(schema.auditEvents)).toHaveLength(4);
    await expect(deactivateMember(executor, { ...removal, idempotencyKey: randomUUID() })).rejects.toThrow("VERSION_CONFLICT");
    const home = await householdDetails(executor, householdId);
    await expect(deactivateMember(executor, { ...removal, memberId: home.actorMemberId, idempotencyKey: randomUUID() })).rejects.toThrow("LAST_ACTIVE_MEMBER");
  });
  it("serializes competing removals and leaves one active member", async () => {
    const { householdId } = await service.create(input());
    const initial = await householdDetails(executor, householdId);
    const [peer] = await db.insert(schema.householdMembers).values({ householdId, userId: "peer" }).returning();
    const outcomes = await Promise.allSettled([initial.actorMemberId, peer.id].map((memberId) => deactivateMember(executor, { householdId, memberId, expectedVersion: 1, idempotencyKey: randomUUID() })));
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const members = await db.select().from(schema.householdMembers).where(eq(schema.householdMembers.householdId, householdId));
    expect(members.filter((member) => member.status === "active")).toHaveLength(1);
  });
  it("rejects invalid inputs, absent and revoked sessions without creating records", async () => {
    for (const change of [{ name: " " }, { name: "x".repeat(101) }, { timezone: "Invalid/Zone" }, { timezone: "posix/America/New_York" }, { timezone: "right/America/New_York" }, { idempotencyKey: "bad" }, { includePlannedMeals: undefined }]) await expect(service.create({ ...input(), ...change } as ReturnType<typeof input>)).rejects.toThrow("INVALID_INPUT");
    const anonymous = createHouseholdService(db, async () => null);
    await expect(anonymous.create(input())).rejects.toThrow("UNAUTHENTICATED");
    await expect(anonymous.list()).rejects.toThrow("UNAUTHENTICATED");
    expect(() => householdDetails(executor, "invalid")).toThrow("ACCESS_DENIED");
    await db.delete(schema.session).where(eq(schema.session.id, identity.id));
    await expect(service.create(input())).rejects.toThrow("UNAUTHENTICATED");
    expect(await db.select().from(schema.households)).toHaveLength(0);
  });
  it.each(["UTC", "utc", "US/Eastern", "Etc/GMT+3", "Europe/London"])("persists canonical supported timezone %s", async (timezone) => {
    const { householdId } = await service.create({ ...input(), timezone });
    const details = await householdDetails(executor, householdId);
    expect(details.timezone).toBe(new Intl.DateTimeFormat("en", { timeZone: timezone }).resolvedOptions().timeZone);
  });
});
