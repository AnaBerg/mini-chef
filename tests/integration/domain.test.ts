// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createDomainExecutor, deactivateMember, readMember, type DomainDatabase, type CommandContext } from "@/lib/domain/commands";

vi.mock("server-only", () => ({}));
const databaseUrl = process.env.DOMAIN_TEST_DATABASE_URL;
if (process.env.CI && !databaseUrl) throw new Error("DOMAIN_TEST_DATABASE_URL is required in CI.");

// Dedicated databases also exercise the migrations' explicit public schema references.
describe.skipIf(!databaseUrl)("household command PostgreSQL integration", () => {
  let admin: ReturnType<typeof postgres>;
  let client: ReturnType<typeof postgres>;
  let db: DomainDatabase;
  let databaseName: string;
  let householdId: string;
  let foreignHouseholdId: string;
  let actorId: string;
  let memberId: string;
  let foreignMemberId: string;
  let actorSessionId: string;
  let otherSessionId: string;
  let executor: ReturnType<typeof createDomainExecutor>;
  let otherExecutor: ReturnType<typeof createDomainExecutor>;

  async function createDatabase() {
    const name = `domain_test_${randomUUID().replaceAll("-", "")}`;
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const connection = postgres(url.toString(), { max: 10, connection: { application_name: name }, onnotice: () => {} });
    return { name, connection, database: drizzle(connection, { schema }) };
  }
  beforeAll(async () => {
    admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const created = await createDatabase();
    databaseName = created.name;
    client = created.connection;
    db = created.database;
    await migrate(db, { migrationsFolder: "drizzle" });
  });
  afterAll(async () => {
    await client?.end();
    if (databaseName) await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin?.end();
  });
  beforeEach(async () => {
    await client`TRUNCATE households, "user" CASCADE`;
    await db.insert(schema.user).values([
      { id: "actor", name: "Actor", email: "actor@example.test" },
      { id: "member", name: "Member", email: "member@example.test" },
      { id: "outsider", name: "Outsider", email: "outsider@example.test" },
    ]);
    actorSessionId = randomUUID();
    otherSessionId = randomUUID();
    await db.insert(schema.session).values([
      { id: actorSessionId, token: randomUUID(), userId: "actor", expiresAt: new Date(Date.now() + 3600_000) },
      { id: otherSessionId, token: randomUUID(), userId: "member", expiresAt: new Date(Date.now() + 3600_000) },
    ]);
    const homes = await db.insert(schema.households).values([
      { name: "Home", timezone: "America/Sao_Paulo" }, { name: "Other", timezone: "UTC" },
    ]).returning();
    [householdId, foreignHouseholdId] = homes.map((home) => home.id);
    const members = await db.insert(schema.householdMembers).values([
      { householdId, userId: "actor" }, { householdId, userId: "member" },
      { householdId: foreignHouseholdId, userId: "outsider" },
    ]).returning();
    [actorId, memberId, foreignMemberId] = members.map((member) => member.id);
    await db.insert(schema.shoppingSettings).values({ householdId, includePlannedMeals: false });
    executor = createDomainExecutor(db, async () => ({ id: actorSessionId, userId: "actor" }));
    otherExecutor = createDomainExecutor(db, async () => ({ id: otherSessionId, userId: "member" }));
  });

  const command = (householdId: string, key = "update", input = { days: 14 }) => ({ householdId, idempotencyKey: key, kind: "settings.update", input });
  async function changeSettings({ tx, householdId }: CommandContext) {
    const [settings] = await tx.update(schema.shoppingSettings).set({ planningHorizonDays: 14,
      version: sql`${schema.shoppingSettings.version} + 1`, updatedAt: new Date() })
      .where(eq(schema.shoppingSettings.householdId, householdId)).returning();
    return { settingsId: settings.id, version: settings.version };
  }
  function gate() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    return { promise, release };
  }
  async function waitForBlockedQuery() {
    for (let attempt = 0; attempt < 150; attempt++) {
      const [state] = await client`SELECT count(*)::integer AS count FROM pg_stat_activity
        WHERE datname = ${databaseName} AND wait_event_type = 'Lock'`;
      if (state.count > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Expected a real blocked PostgreSQL transaction");
  }

  it("migrates an empty database and preserves the populated auth-only upgrade path", async () => {
    expect((await db.select().from(schema.shoppingSettings))[0].planningHorizonDays).toBe(7);
    const upgrade = await createDatabase();
    const folder = await mkdtemp(join(tmpdir(), "mini-chef-migrations-"));
    try {
      await mkdir(join(folder, "meta"));
      const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
      journal.entries = journal.entries.slice(0, 1);
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
      await copyFile("drizzle/0000_create_auth_tables.sql", join(folder, "0000_create_auth_tables.sql"));
      await migrate(upgrade.database, { migrationsFolder: folder });
      await upgrade.database.insert(schema.user).values({ id: "existing", name: "Existing", email: "existing@example.test" });
      await upgrade.database.insert(schema.session).values({ id: "existing-session", token: "existing-token", userId: "existing", expiresAt: new Date(Date.now() + 3600_000) });
      await migrate(upgrade.database, { migrationsFolder: "drizzle" });
      await migrate(upgrade.database, { migrationsFolder: "drizzle" });
      expect((await upgrade.database.select().from(schema.user))[0].id).toBe("existing");
      expect((await upgrade.database.select().from(schema.session))[0].token).toBe("existing-token");
      expect(await upgrade.database.select().from(schema.domainOperations)).toEqual([]);
    } finally {
      await upgrade.connection.end();
      await admin.unsafe(`DROP DATABASE "${upgrade.name}" WITH (FORCE)`);
      await rm(folder, { recursive: true });
    }
  });

  it("scopes reads and writes, rejects absent or inactive membership, and requires a live matching session", async () => {
    expect((await executor.read(householdId, (ctx) => readMember(ctx, memberId))).id).toBe(memberId);
    await expect(executor.read(householdId, (ctx) => readMember(ctx, foreignMemberId))).rejects.toThrow("NOT_FOUND");
    await expect(executor.read(foreignHouseholdId, (ctx) => readMember(ctx, foreignMemberId))).rejects.toThrow("ACCESS_DENIED");
    await expect(executor.execute(command(foreignHouseholdId), changeSettings)).rejects.toThrow("ACCESS_DENIED");
    await expect(executor.execute(command(randomUUID()), changeSettings)).rejects.toThrow("ACCESS_DENIED");
    await expect(deactivateMember(executor, { householdId, idempotencyKey: "foreign", memberId: foreignMemberId, expectedVersion: 1 })).rejects.toThrow("NOT_FOUND");
    const anonymous = createDomainExecutor(db, async () => null);
    await expect(anonymous.execute(command(householdId), changeSettings)).rejects.toThrow("UNAUTHENTICATED");
    const wrongSession = createDomainExecutor(db, async () => ({ id: otherSessionId, userId: "actor" }));
    await expect(wrongSession.execute(command(householdId), changeSettings)).rejects.toThrow("UNAUTHENTICATED");
    await db.update(schema.session).set({ expiresAt: new Date(0) }).where(eq(schema.session.id, actorSessionId));
    await expect(executor.execute(command(householdId), changeSettings)).rejects.toThrow("UNAUTHENTICATED");
    await db.update(schema.householdMembers).set({ status: "inactive" }).where(eq(schema.householdMembers.id, memberId));
    await expect(otherExecutor.execute(command(householdId), changeSettings)).rejects.toThrow("ACCESS_DENIED");
    expect(await db.select().from(schema.domainOperations)).toEqual([]);
  });

  it("replays the committed original result and rejects changed input, kind, and actor", async () => {
    const original = await executor.execute(command(householdId), changeSettings);
    const handler = vi.fn(changeSettings);
    expect(await executor.execute(command(householdId), handler)).toEqual(original);
    expect(handler).not.toHaveBeenCalled();
    await expect(executor.execute(command(householdId, "update", { days: 20 }), handler)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(executor.execute({ ...command(householdId), kind: "another.command" }, handler)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(otherExecutor.execute(command(householdId), handler)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect(await db.select().from(schema.domainOperations)).toHaveLength(1);
    expect(await db.select().from(schema.auditEvents)).toHaveLength(1);
  });

  it("rolls back operation, domain writes and audit when a handler or result serialization fails", async () => {
    await expect(executor.execute(command(householdId), async (ctx) => {
      await changeSettings(ctx);
      await ctx.tx.insert(schema.auditEvents).values({ householdId, operationId: ctx.operationId, actorMemberId: actorId,
        entityType: "settings", entityId: householdId, action: "test" });
      throw new Error("intentional failure");
    })).rejects.toThrow("intentional failure");
    await expect(executor.execute(command(householdId), async (ctx) => {
      await changeSettings(ctx);
      return Number.NaN;
    })).rejects.toThrow("INVALID_INPUT");
    expect((await db.select().from(schema.shoppingSettings))[0].version).toBe(1);
    expect(await db.select().from(schema.domainOperations)).toEqual([]);
    expect(await db.select().from(schema.auditEvents)).toEqual([]);
    expect((await executor.execute(command(householdId), changeSettings)).version).toBe(2);
  });

  it("rejects invalid command metadata and rolls back a command when its session expires before completion", async () => {
    for (const request of [
      { ...command(householdId), idempotencyKey: " " },
      { ...command(householdId), idempotencyKey: "x".repeat(201) },
      { ...command(householdId), kind: " " },
      { ...command(householdId), kind: "x".repeat(101) },
    ]) await expect(executor.execute(request, changeSettings)).rejects.toThrow("INVALID_INPUT");
    await expect(executor.execute(command(householdId), async (ctx) => {
      await changeSettings(ctx);
      await ctx.tx.update(schema.session).set({ expiresAt: new Date(0) }).where(eq(schema.session.id, actorSessionId));
      return { completed: true };
    })).rejects.toThrow("UNAUTHENTICATED");
    expect((await db.select().from(schema.shoppingSettings))[0].version).toBe(1);
    expect(await db.select().from(schema.domainOperations)).toEqual([]);
  });

  it("serializes concurrent duplicate requests and executes the handler exactly once", async () => {
    const entered = gate(); const finish = gate();
    const handler = vi.fn(async (ctx: CommandContext) => { entered.release(); await finish.promise; return changeSettings(ctx); });
    const first = executor.execute(command(householdId), handler);
    await entered.promise;
    const second = executor.execute(command(householdId), handler);
    try { await waitForBlockedQuery(); } finally { finish.release(); }
    const results = await Promise.all([first, second]);
    expect(results[0]).toEqual(results[1]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await db.select().from(schema.domainOperations)).toHaveLength(1);
  });

  it("lets an authorized command commit before a waiting deactivation, then rejects retries", async () => {
    const entered = gate(); const finish = gate();
    const first = otherExecutor.execute(command(householdId), async (ctx) => { entered.release(); await finish.promise; return changeSettings(ctx); });
    await entered.promise;
    const deactivation = deactivateMember(executor, { householdId, idempotencyKey: "deactivate", memberId, expectedVersion: 1 });
    try { await waitForBlockedQuery(); } finally { finish.release(); }
    await first;
    expect((await deactivation).status).toBe("inactive");
    await expect(otherExecutor.execute(command(householdId), changeSettings)).rejects.toThrow("ACCESS_DENIED");
    expect((await db.select().from(schema.shoppingSettings))[0].version).toBe(2);
    expect((await db.select().from(schema.householdMembers).where(eq(schema.householdMembers.id, memberId)))[0].version).toBe(2);
  });

  it("rejects a waiting command when deactivation wins the household lock", async () => {
    const entered = gate(); const finish = gate();
    const first = executor.execute({ ...command(householdId, "deactivate"), kind: "member.deactivate" }, async (ctx) => {
      await ctx.tx.update(schema.householdMembers).set({ status: "inactive" }).where(and(
        eq(schema.householdMembers.householdId, householdId), eq(schema.householdMembers.id, memberId),
      ));
      entered.release(); await finish.promise; return { status: "inactive" };
    });
    await entered.promise;
    const waiting = expect(otherExecutor.execute(command(householdId), changeSettings)).rejects.toThrow("ACCESS_DENIED");
    try { await waitForBlockedQuery(); } finally { finish.release(); }
    await Promise.all([first, waiting]);
    expect((await db.select().from(schema.shoppingSettings))[0].version).toBe(1);
  });

  it("membership FOR SHARE prevents even a direct status update until the command commits", async () => {
    const entered = gate(); const finish = gate();
    const running = otherExecutor.execute(command(householdId), async (ctx) => {
      entered.release(); await finish.promise; return changeSettings(ctx);
    });
    await entered.promise;
    const update = db.update(schema.householdMembers).set({ status: "inactive" }).where(eq(schema.householdMembers.id, memberId)).execute();
    try { await waitForBlockedQuery(); } finally { finish.release(); }
    await Promise.all([running, update]);
    await expect(otherExecutor.read(householdId, (ctx) => readMember(ctx, memberId))).rejects.toThrow("ACCESS_DENIED");
  });

  it("checks optimistic versions, preserves audit, and permits equal member permissions", async () => {
    await expect(deactivateMember(otherExecutor, { householdId, idempotencyKey: "stale", memberId: actorId, expectedVersion: 2 })).rejects.toThrow("VERSION_CONFLICT");
    const result = await deactivateMember(otherExecutor, { householdId, idempotencyKey: "deactivate", memberId: actorId, expectedVersion: 1 });
    expect(result.version).toBe(2);
    expect(await deactivateMember(otherExecutor, { householdId, idempotencyKey: "deactivate", memberId: actorId, expectedVersion: 1 })).toEqual(result);
    const [audit] = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityType, "household_member"));
    expect(audit.beforeData).toEqual({ status: "active", version: 1 });
    expect(audit.afterData).toEqual({ status: "inactive", version: 2 });
  });

  it("enforces composite tenant foreign keys, unique membership, account references and timezone at the database boundary", async () => {
    const op = { householdId, actorMemberId: foreignMemberId, kind: "test", idempotencyKey: "test", requestHash: "a".repeat(64), result: {} };
    await expect(db.insert(schema.domainOperations).values(op)).rejects.toThrow();
    await expect(db.insert(schema.householdMembers).values({ householdId, userId: "actor" })).rejects.toThrow();
    await expect(db.insert(schema.householdMembers).values({ householdId, userId: "missing" })).rejects.toThrow();
    await expect(db.insert(schema.households).values({ name: "Wrong", timezone: "Invented/Zone" })).rejects.toThrow();
    await expect(db.update(schema.households).set({ timezone: "PST" }).where(eq(schema.households.id, householdId))).rejects.toThrow();
    await expect(db.insert(schema.auditEvents).values({ householdId, actorMemberId: foreignMemberId, entityType: "test", entityId: householdId, action: "test" })).rejects.toThrow();
    const [foreignOp] = await db.insert(schema.domainOperations).values({ ...op, householdId: foreignHouseholdId }).returning();
    await expect(db.insert(schema.auditEvents).values({ householdId, actorMemberId: actorId, operationId: foreignOp.id,
      entityType: "test", entityId: householdId, action: "test" })).rejects.toThrow();
    await expect(db.delete(schema.householdMembers).where(eq(schema.householdMembers.id, foreignMemberId))).rejects.toThrow();
    await expect(db.delete(schema.user).where(eq(schema.user.id, "outsider"))).rejects.toThrow();
    await expect(db.update(schema.shoppingSettings).set({ planningHorizonDays: 0 })).rejects.toThrow();
  });
});
