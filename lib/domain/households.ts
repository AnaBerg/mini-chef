import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { type AuthenticatedSession, type DomainDatabase, type DomainExecutor, DomainError, normalizeTimezone, requestHash, requireSession } from "./commands";

export const isUuid = (value: string) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export type CreationInput = { name: string; timezone: string; includePlannedMeals: boolean; idempotencyKey: string };

export function createHouseholdService(db: DomainDatabase, resolveSession: () => Promise<AuthenticatedSession | null>) {
  return {
    async create(input: CreationInput) {
      const identity = await resolveSession();
      if (!identity) throw new DomainError("UNAUTHENTICATED");
      if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 100 || typeof input.includePlannedMeals !== "boolean" || !isUuid(input.idempotencyKey)) throw new DomainError("INVALID_INPUT");
      const values = { name: input.name.trim(), timezone: normalizeTimezone(input.timezone), includePlannedMeals: input.includePlannedMeals };
      const hash = requestHash(values);
      const find = (tx: DomainDatabase | Parameters<Parameters<DomainDatabase["transaction"]>[0]>[0]) => tx.select().from(schema.householdCreationRequests).where(and(eq(schema.householdCreationRequests.userId, identity.userId), eq(schema.householdCreationRequests.idempotencyKey, input.idempotencyKey)));
      const replay = (previous: typeof schema.householdCreationRequests.$inferSelect) => {
        if (previous.requestHash !== hash) throw new DomainError("IDEMPOTENCY_CONFLICT");
        return { householdId: previous.householdId };
      };
      try {
        return await db.transaction(async (tx) => {
          await requireSession(tx, identity);
          const [previous] = await find(tx);
          if (previous) { await requireSession(tx, identity); return replay(previous); }
          // Check the database catalog too: ICU and PostgreSQL can ship different tzdata.
          const zones = await tx.execute(sql`SELECT name FROM pg_timezone_names WHERE name = ${values.timezone}`);
          if (!zones.length) throw new DomainError("INVALID_INPUT");
          const [home] = await tx.insert(schema.households).values({ name: values.name, timezone: values.timezone }).returning();
          const [actor] = await tx.insert(schema.householdMembers).values({ householdId: home.id, userId: identity.userId }).returning();
          await tx.insert(schema.shoppingSettings).values({ householdId: home.id, includePlannedMeals: values.includePlannedMeals });
          const operationId = randomUUID();
          await tx.insert(schema.domainOperations).values({ id: operationId, householdId: home.id, actorMemberId: actor.id, kind: "household.create", idempotencyKey: input.idempotencyKey, requestHash: hash, result: { householdId: home.id } });
          await tx.insert(schema.auditEvents).values({ householdId: home.id, actorMemberId: actor.id, operationId, entityType: "household", entityId: home.id, action: "household.create", afterData: values });
          await requireSession(tx, identity);
          // Unique-key losers roll back every provisional row before reading the winner.
          await tx.insert(schema.householdCreationRequests).values({ userId: identity.userId, idempotencyKey: input.idempotencyKey, requestHash: hash, householdId: home.id });
          await requireSession(tx, identity);
          return { householdId: home.id };
        });
      } catch (error) {
        const cause = error instanceof Error && error.cause ? error.cause : error;
        if (!(typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23505" && "constraint_name" in cause && cause.constraint_name === "household_creation_requests_user_key")) throw error;
        return db.transaction(async (tx) => {
          await requireSession(tx, identity);
          const [winner] = await find(tx);
          if (!winner) throw error;
          await requireSession(tx, identity);
          return replay(winner);
        });
      }
    },
    async list() {
      const identity = await resolveSession();
      if (!identity) throw new DomainError("UNAUTHENTICATED");
      return db.transaction(async (tx) => {
        await requireSession(tx, identity);
        return tx.select({ id: schema.households.id, name: schema.households.name }).from(schema.households).innerJoin(schema.householdMembers, eq(schema.householdMembers.householdId, schema.households.id)).where(and(eq(schema.householdMembers.userId, identity.userId), eq(schema.householdMembers.status, "active"))).orderBy(asc(schema.households.name));
      });
    },
  };
}

export function householdDetails(executor: DomainExecutor, householdId: string) {
  if (!isUuid(householdId)) throw new DomainError("ACCESS_DENIED");
  return executor.read(householdId, async ({ tx, actorMemberId }) => {
    const [home] = await tx.select().from(schema.households).where(eq(schema.households.id, householdId));
    const members = await tx.select({ id: schema.householdMembers.id, name: schema.user.name, status: schema.householdMembers.status, version: schema.householdMembers.version }).from(schema.householdMembers).innerJoin(schema.user, eq(schema.user.id, schema.householdMembers.userId)).where(eq(schema.householdMembers.householdId, householdId)).orderBy(asc(schema.user.name));
    return { name: home.name, timezone: home.timezone, actorMemberId, members };
  });
}
