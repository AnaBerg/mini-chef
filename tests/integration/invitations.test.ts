// @vitest-environment node
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "@/lib/db/schema";
import { createDomainExecutor, deactivateMember, type DomainDatabase } from "@/lib/domain/commands";
import { createHouseholdService } from "@/lib/domain/households";
import { createInvitation, createInvitationService, listInvitations, revokeInvitation } from "@/lib/domain/invitations";
vi.mock("server-only", () => ({}));
const databaseUrl = process.env.DOMAIN_TEST_DATABASE_URL;
if (process.env.CI && !databaseUrl) throw new Error("DOMAIN_TEST_DATABASE_URL is required in CI.");
describe.skipIf(!databaseUrl)("single-use invitations", () => {
  let admin: ReturnType<typeof postgres>, client: ReturnType<typeof postgres>, db: DomainDatabase, databaseName: string, householdId: string;
  const identity = (userId: string) => ({ userId, id: `${userId}-session` });
  const executor = (id = "creator") => createDomainExecutor(db, async () => identity(id));
  const service = (id = "peer") => createInvitationService(db, async () => identity(id));
  const create = () => createInvitation(executor(), { householdId, idempotencyKey: randomUUID() });
  beforeAll(async () => {
    admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} }); databaseName = `invitations_test_${randomUUID().replaceAll("-", "")}`;
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(databaseUrl!); url.pathname = `/${databaseName}`;
    client = postgres(url.toString(), { max: 10, onnotice: () => {} }); db = drizzle(client, { schema: s }); await migrate(db, { migrationsFolder: "drizzle" });
  });
  afterAll(async () => { await client?.end(); if (databaseName) await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`); await admin?.end(); });
  beforeEach(async () => {
    await client`TRUNCATE households, "user" CASCADE`;
    for (const id of ["creator", "peer", "other"]) {
      await db.insert(s.user).values({ id, name: id, email: `${id}@example.test` });
      await db.insert(s.session).values({ ...identity(id), token: randomUUID(), expiresAt: new Date(Date.now() + 3600_000) });
    }
    ({ householdId } = await createHouseholdService(db, async () => identity("creator")).create({ name: "Our kitchen", timezone: "UTC", includePlannedMeals: false, idempotencyKey: randomUUID() }));
  });
  it("stores only hashes, creates once, previews minimally and gives every member invitation permissions", async () => {
    const input = { householdId, idempotencyKey: randomUUID() };
    const invite = await createInvitation(executor(), input);
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await createInvitation(executor(), input)).toEqual({ ...invite, token: null });
    expect(await service().preview(invite.token!)).toEqual({ name: "Our kitchen" });
    expect(await service().preview("x".repeat(43))).toBeNull();
    await expect(service().preview("bad")).rejects.toThrow("NOT_FOUND");
    const accepted = await service().accept(invite.token!, true);
    expect(await service().preview(invite.token!)).toBeNull();
    expect(await service().accept(invite.token!, true)).toEqual(accepted);
    expect(await listInvitations(executor(), householdId)).toEqual([]);
    const peerInvite = await createInvitation(executor("peer"), { householdId, idempotencyKey: randomUUID() });
    expect(await listInvitations(executor("peer"), householdId)).toHaveLength(1);
    for (const table of [s.householdInvitations, s.domainOperations, s.auditEvents]) expect(JSON.stringify(await db.select().from(table))).not.toContain(invite.token);
    await revokeInvitation(executor("peer"), { householdId, invitationId: peerInvite.invitationId, idempotencyKey: randomUUID() });
    expect(await listInvitations(executor(), householdId)).toEqual([]);
  });
  it("replays accepted invitations after expiry and creator removal without mutation; new invitations reactivate original identity", async () => {
    const invite = await create(); const accepted = await service().accept(invite.token!, true);
    await db.update(s.householdInvitations).set({ expiresAt: new Date(0) }).where(eq(s.householdInvitations.id, invite.invitationId));
    const [creator] = await db.select().from(s.householdMembers).where(eq(s.householdMembers.userId, "creator"));
    await deactivateMember(executor("peer"), { householdId, memberId: creator.id, expectedVersion: creator.version, idempotencyKey: randomUUID() });
    const before = await db.select().from(s.auditEvents);
    expect(await service().accept(invite.token!, true)).toEqual(accepted);
    expect(await db.select().from(s.auditEvents)).toEqual(before);
    const newInvite = await createInvitation(executor("peer"), { householdId, idempotencyKey: randomUUID() });
    const restored = await service("creator").accept(newInvite.token!, true);
    expect(restored.memberId).toBe(creator.id);
    await deactivateMember(executor(), { householdId, memberId: accepted.memberId, expectedVersion: 1, idempotencyKey: randomUUID() });
    const [removed] = await db.select().from(s.householdMembers).where(eq(s.householdMembers.id, accepted.memberId));
    const operations = await db.select().from(s.domainOperations);
    expect(await service().accept(invite.token!, true)).toEqual({ ...accepted, status: "inactive" });
    expect((await db.select().from(s.householdMembers).where(eq(s.householdMembers.id, accepted.memberId)))[0]).toEqual(removed);
    expect(await db.select().from(s.domainOperations)).toEqual(operations);
    const fresh = await create(); const reactivated = await service().accept(fresh.token!, true);
    expect(reactivated.memberId).toBe(accepted.memberId);
    const [member] = await db.select().from(s.householdMembers).where(eq(s.householdMembers.id, accepted.memberId));
    expect(member).toMatchObject({ joinedAt: removed.joinedAt, createdAt: removed.createdAt, version: removed.version + 1, status: "active" });
    // Dietary tables belong to #9; preserving the exact membership row preserves future FK history.
    expect(await db.select().from(s.householdMembers)).toHaveLength(2);
  });
  it("rejects fresh expired/revoked/inactive-creator links, other-account replay and absent consent", async () => {
    const expired = await create(); await db.update(s.householdInvitations).set({ expiresAt: new Date(0) }).where(eq(s.householdInvitations.id, expired.invitationId));
    expect(await service().preview(expired.token!)).toBeNull(); await expect(service().accept(expired.token!, true)).rejects.toThrow("NOT_FOUND");
    const revoked = await create(); const request = { householdId, invitationId: revoked.invitationId, idempotencyKey: randomUUID() };
    await revokeInvitation(executor(), request); await revokeInvitation(executor(), request); await revokeInvitation(executor(), { ...request, idempotencyKey: randomUUID() });
    expect(await service().preview(revoked.token!)).toBeNull(); await expect(service().accept(revoked.token!, true)).rejects.toThrow("NOT_FOUND");
    const invite = await create(); await expect(service().accept(invite.token!, false)).rejects.toThrow("INVALID_INPUT");
    await service().accept(invite.token!, true);
    await expect(service("other").accept(invite.token!, true)).rejects.toThrow("NOT_FOUND");
    await expect(revokeInvitation(executor(), { householdId, invitationId: invite.invitationId, idempotencyKey: randomUUID() })).rejects.toThrow("NOT_FOUND");
    const inactive = await create(); const [creator] = await db.select().from(s.householdMembers).where(eq(s.householdMembers.userId, "creator"));
    await deactivateMember(executor("peer"), { householdId, memberId: creator.id, expectedVersion: 1, idempotencyKey: randomUUID() });
    expect(await service("other").preview(inactive.token!)).toBeNull(); await expect(service("other").accept(inactive.token!, true)).rejects.toThrow("NOT_FOUND");
  });
  it("requires backed sessions and valid scoped identifiers", async () => {
    const anonymous = createInvitationService(db, async () => null);
    await expect(anonymous.accept("x".repeat(43), true)).rejects.toThrow("UNAUTHENTICATED"); await expect(anonymous.preview("x".repeat(43))).rejects.toThrow("UNAUTHENTICATED");
    await expect(service().accept("bad", true)).rejects.toThrow("NOT_FOUND"); await expect(service().accept("x".repeat(43), true)).rejects.toThrow("NOT_FOUND");
    await expect(createInvitation(executor(), { householdId: "bad", idempotencyKey: randomUUID() })).rejects.toThrow("INVALID_INPUT");
    await expect(listInvitations(executor(), "bad")).rejects.toThrow("ACCESS_DENIED");
    await expect(revokeInvitation(executor(), { householdId, invitationId: "bad", idempotencyKey: randomUUID() })).rejects.toThrow("INVALID_INPUT");
    await expect(revokeInvitation(executor(), { householdId, invitationId: randomUUID(), idempotencyKey: randomUUID() })).rejects.toThrow("NOT_FOUND");
    await expect(listInvitations(executor("other"), householdId)).rejects.toThrow("ACCESS_DENIED");
    const invite = await create(); await db.delete(s.session).where(eq(s.session.userId, "peer"));
    await expect(service().accept(invite.token!, true)).rejects.toThrow("UNAUTHENTICATED");
  });
  async function race(run: () => Promise<unknown>[]) {
    let ready!: () => void, release!: () => void;
    const locked = new Promise<void>((resolve) => { ready = resolve; }); const released = new Promise<void>((resolve) => { release = resolve; });
    const blocker = client.begin(async (tx) => { await tx`SELECT id FROM households WHERE id = ${householdId} FOR UPDATE`; ready(); await released; });
    await locked; const outcomes = Promise.allSettled(run());
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 150; attempt++) {
        const [state] = await client`SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = ${databaseName} AND wait_event_type = 'Lock'`;
        if (state.count >= 2) { blocked = true; break; } await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
    } finally { release(); await blocker; }
    return outcomes;
  }
  it("serializes concurrent consumers and same-account retries at a deterministic household lock barrier", async () => {
    const invite = await create();
    const results = await race(() => [service().accept(invite.token!, true), service("other").accept(invite.token!, true)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "NOT_FOUND" } });
    const next = await create(); const same = await race(() => [service().accept(next.token!, true), service().accept(next.token!, true)]);
    expect(same[0].status).toBe("fulfilled"); expect(same[0]).toEqual(same[1]);
    expect(await db.select().from(s.domainOperations).where(eq(s.domainOperations.kind, "invitation.accept"))).toHaveLength(2);
  });
  it("serializes revocation against acceptance and never permits a revoked fresh consumption", async () => {
    const invite = await create();
    const results = await race(() => [revokeInvitation(executor(), { householdId, invitationId: invite.invitationId, idempotencyKey: randomUUID() }), service().accept(invite.token!, true)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [row] = await db.select().from(s.householdInvitations).where(eq(s.householdInvitations.id, invite.invitationId));
    expect(Boolean(row.acceptedAt)).not.toBe(Boolean(row.revokedAt));
  });
  it("rechecks expiry and creator activity after waiting for the household lock", async () => {
    await db.insert(s.householdMembers).values({ householdId, userId: "other" });
    for (const invalidate of ["expiry", "creator"]) {
      const invite = await create();
      let ready!: () => void, release!: () => void;
      const locked = new Promise<void>((resolve) => { ready = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      const blocker = client.begin(async (tx) => {
        await tx`SELECT id FROM households WHERE id = ${householdId} FOR UPDATE`;
        ready(); await released;
        if (invalidate === "expiry") await tx`UPDATE household_invitations SET expires_at = clock_timestamp() WHERE id = ${invite.invitationId}`;
        else await tx`UPDATE household_members SET status = 'inactive' WHERE household_id = ${householdId} AND user_id = 'creator'`;
      });
      await locked;
      const outcome = service().accept(invite.token!, true).catch((error: unknown) => error);
      try {
        let blocked = false;
        for (let attempt = 0; attempt < 150; attempt++) {
          const [state] = await client`SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = ${databaseName} AND wait_event_type = 'Lock'`;
          if (state.count >= 1) { blocked = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
      } finally { release(); await blocker; }
      expect(await outcome).toMatchObject({ code: "NOT_FOUND" });
      expect(await db.select().from(s.householdMembers).where(eq(s.householdMembers.userId, "peer"))).toHaveLength(0);
    }
  });
  it("serializes preview with revocation and creator deactivation before exposing the name", async () => {
    await db.insert(s.householdMembers).values({ householdId, userId: "other" });
    for (const invalidate of ["revocation", "creator"]) {
      const invite = await create();
      let ready!: () => void, release!: () => void;
      const locked = new Promise<void>((resolve) => { ready = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      const blocker = client.begin(async (tx) => {
        await tx`SELECT id FROM households WHERE id = ${householdId} FOR UPDATE`;
        ready(); await released;
        if (invalidate === "revocation") await tx`UPDATE household_invitations SET revoked_at = clock_timestamp() WHERE id = ${invite.invitationId}`;
        else await tx`UPDATE household_members SET status = 'inactive' WHERE household_id = ${householdId} AND user_id = 'creator'`;
      });
      await locked;
      const outcome = service().preview(invite.token!).catch((error: unknown) => error);
      try {
        let blocked = false;
        for (let attempt = 0; attempt < 150; attempt++) {
          const [state] = await client`SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = ${databaseName} AND wait_event_type = 'Lock'`;
          if (state.count >= 1) { blocked = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
      } finally { release(); await blocker; }
      expect(await outcome).toBeNull();
      expect(await db.select().from(s.householdMembers).where(eq(s.householdMembers.userId, "peer"))).toHaveLength(0);
    }
  });
  it("holds preview locks through session validation so revocation waits for the read", async () => {
    const invite = await create();
    let ready!: () => void, release!: () => void;
    const locked = new Promise<void>((resolve) => { ready = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const blocker = client.begin(async (tx) => {
      await tx`SELECT id FROM session WHERE id = 'peer-session' FOR UPDATE`;
      ready(); await released;
    });
    async function waitForLocks(count: number) {
      for (let attempt = 0; attempt < 150; attempt++) {
        const [state] = await client`SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = ${databaseName} AND wait_event_type = 'Lock'`;
        if (state.count === count) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("Expected database lock barrier was not reached");
    }
    await locked;
    const preview = service().preview(invite.token!);
    let revocation: Promise<unknown> | undefined;
    try {
      await waitForLocks(1);
      revocation = revokeInvitation(executor(), { householdId, invitationId: invite.invitationId, idempotencyKey: randomUUID() });
      await waitForLocks(2);
    } finally { release(); await blocker; }
    expect(await preview).toEqual({ name: "Our kitchen" });
    await revocation;
    expect(await service().preview(invite.token!)).toBeNull();
  });
  it("rejects fresh links on the read-only retry path without consuming them", async () => {
    const invite = await create();
    await expect(service().accept(invite.token!, true, true)).rejects.toThrow("NOT_FOUND");
    expect(await service().preview(invite.token!)).toEqual({ name: "Our kitchen" });
  });
  it("rolls back membership, operation and consumption when acceptance audit fails", async () => {
    const invite = await create();
    await client`CREATE FUNCTION reject_invitation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'invitation.accept' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$`;
    await client`CREATE TRIGGER reject_invitation_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_invitation_audit()`;
    try { await expect(service().accept(invite.token!, true)).rejects.toThrow(); }
    finally { await client`DROP TRIGGER reject_invitation_audit ON audit_events`; await client`DROP FUNCTION reject_invitation_audit()`; }
    expect(await db.select().from(s.householdMembers).where(eq(s.householdMembers.userId, "peer"))).toHaveLength(0);
    expect(await db.select().from(s.domainOperations).where(eq(s.domainOperations.kind, "invitation.accept"))).toHaveLength(0);
    expect((await db.select().from(s.householdInvitations).where(eq(s.householdInvitations.id, invite.invitationId)))[0].acceptedAt).toBeNull();
    expect(await service().preview(invite.token!)).toEqual({ name: "Our kitchen" });
  });
  it("enforces invitation hash, tenant creator and acceptance pairing constraints", async () => {
    const invite = await create(); const [row] = await db.select().from(s.householdInvitations);
    await expect(db.insert(s.householdInvitations).values({ householdId, createdByMemberId: row.createdByMemberId, tokenHash: row.tokenHash, expiresAt: new Date() })).rejects.toThrow();
    await expect(db.update(s.householdInvitations).set({ acceptedAt: new Date() }).where(eq(s.householdInvitations.id, invite.invitationId))).rejects.toThrow();
    await expect(db.update(s.householdInvitations).set({ acceptedAt: new Date(), acceptedByUserId: "missing" }).where(eq(s.householdInvitations.id, invite.invitationId))).rejects.toThrow();
    const [foreign] = await db.insert(s.households).values({ name: "Foreign", timezone: "UTC" }).returning();
    await expect(db.update(s.householdInvitations).set({ householdId: foreign.id }).where(eq(s.householdInvitations.id, invite.invitationId))).rejects.toThrow();
  });
});
