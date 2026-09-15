import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

export type DomainDatabase = PostgresJsDatabase<typeof schema>;
export type DomainTransaction = Parameters<Parameters<DomainDatabase["transaction"]>[0]>[0];
export type AuthenticatedSession = { id: string; userId: string };
export type JsonValue = schema.JsonValue;
export class DomainError extends Error {
  constructor(public readonly code: "UNAUTHENTICATED" | "ACCESS_DENIED" | "NOT_FOUND" | "IDEMPOTENCY_CONFLICT" | "VERSION_CONFLICT" | "INVALID_INPUT" | "LAST_ACTIVE_MEMBER") {
    super(code);
    this.name = "DomainError";
  }
}

// Reject values whose JSON serialization would silently change request meaning.
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new DomainError("INVALID_INPUT");
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new DomainError("INVALID_INPUT");
}

export function requestHash(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function normalizeTimezone(timezone: string): string {
  if (typeof timezone !== "string" || /^(posix|right)\//i.test(timezone) || (timezone.toUpperCase() !== "UTC" && !/^[A-Za-z_]+\/[A-Za-z0-9_+\-/]+$/.test(timezone))) throw new DomainError("INVALID_INPUT");
  try {
    const canonical = new Intl.DateTimeFormat("en", { timeZone: timezone }).resolvedOptions().timeZone;
    if (canonical !== "UTC" && !/^[A-Za-z_]+\/[A-Za-z0-9_+\-/]+$/.test(canonical)) throw new Error();
    return canonical;
  } catch {
    throw new DomainError("INVALID_INPUT");
  }
}

export function validateTimezone(timezone: string): void {
  normalizeTimezone(timezone);
}

export function expectVersion(actual: number, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 1) throw new DomainError("INVALID_INPUT");
  if (actual !== expected) throw new DomainError("VERSION_CONFLICT");
}

export type HouseholdContext = {
  tx: DomainTransaction;
  householdId: string;
  actorMemberId: string;
};
export type CommandContext = HouseholdContext & { operationId: string };
export type CommandRequest = { householdId: string; idempotencyKey: string; kind: string; input: JsonValue };

export async function requireSession(tx: DomainTransaction, identity: AuthenticatedSession) {
  const [current] = await tx.select({ id: schema.session.id }).from(schema.session).where(and(
    eq(schema.session.id, identity.id), eq(schema.session.userId, identity.userId),
    sql`${schema.session.expiresAt} > clock_timestamp()`,
  )).for("share");
  if (!current) throw new DomainError("UNAUTHENTICATED");
}

/** Server-only kernel. The resolver must derive identity from the trusted auth provider, never request body IDs. */
export function createDomainExecutor(db: DomainDatabase, resolveSession: () => Promise<AuthenticatedSession | null>) {
  async function authorized<T>(householdId: string, write: boolean, run: (context: HouseholdContext) => Promise<T>): Promise<T> {
    const identity = await resolveSession();
    if (!identity) throw new DomainError("UNAUTHENTICATED");
    return db.transaction(async (tx) => {
      const [household] = await tx.select({ id: schema.households.id }).from(schema.households)
        .where(eq(schema.households.id, householdId)).for(write ? "update" : "share");
      if (!household) throw new DomainError("ACCESS_DENIED");
      const [actor] = await tx.select().from(schema.householdMembers).where(and(
        eq(schema.householdMembers.householdId, householdId), eq(schema.householdMembers.userId, identity.userId),
      )).for("share");
      if (!actor || actor.status !== "active") throw new DomainError("ACCESS_DENIED");
      await requireSession(tx, identity);
      const result = await run({ tx, householdId, actorMemberId: actor.id });
      // A request waiting for locks or spending time in a handler cannot outlive its session.
      await requireSession(tx, identity);
      return result;
    });
  }

  return {
    read<T>(householdId: string, query: (context: HouseholdContext) => Promise<T>) {
      return authorized(householdId, false, query);
    },
    execute<T extends JsonValue>(request: CommandRequest, command: (context: CommandContext) => Promise<T>): Promise<T> {
      if (!request.idempotencyKey.trim() || request.idempotencyKey.length > 200 || !request.kind.trim() || request.kind.length > 100) {
        return Promise.reject(new DomainError("INVALID_INPUT"));
      }
      return authorized(request.householdId, true, async (context) => {
        const { tx, householdId, actorMemberId } = context;
        const hash = requestHash({ kind: request.kind, actorMemberId, input: request.input });
        const [previous] = await tx.select().from(schema.domainOperations).where(and(
          eq(schema.domainOperations.householdId, householdId), eq(schema.domainOperations.idempotencyKey, request.idempotencyKey),
        ));
        if (previous) {
          if (previous.requestHash !== hash) throw new DomainError("IDEMPOTENCY_CONFLICT");
          return previous.result as T;
        }
        const operationId = randomUUID();
        await tx.insert(schema.domainOperations).values({ id: operationId, householdId, actorMemberId,
          kind: request.kind, idempotencyKey: request.idempotencyKey, requestHash: hash, result: {} });
        const result = await command({ ...context, operationId });
        // Return the persisted JSON shape on both first execution and replay.
        const storedResult = JSON.parse(canonicalJson(result)) as T;
        await tx.update(schema.domainOperations).set({ result: storedResult }).where(and(
          eq(schema.domainOperations.householdId, householdId), eq(schema.domainOperations.id, operationId),
        ));
        await tx.insert(schema.auditEvents).values({ householdId, actorMemberId, operationId,
          entityType: "household", entityId: householdId, action: request.kind });
        return storedResult;
      });
    },
  };
}

export type DomainExecutor = ReturnType<typeof createDomainExecutor>;

/** A scoped lookup never reveals whether a foreign household owns the requested ID. */
export async function readMember(context: HouseholdContext, memberId: string) {
  const [member] = await context.tx.select().from(schema.householdMembers).where(and(
    eq(schema.householdMembers.householdId, context.householdId), eq(schema.householdMembers.id, memberId),
  ));
  if (!member) throw new DomainError("NOT_FOUND");
  return member;
}

/** Reused by membership management; preserves membership identity and its history. */
export async function deactivateMember(executor: DomainExecutor, request: {
  householdId: string; idempotencyKey: string; memberId: string; expectedVersion: number;
}) {
  return executor.execute({ ...request, kind: "member.deactivate", input: {
    memberId: request.memberId, expectedVersion: request.expectedVersion,
  } }, async (context) => {
    const { tx, householdId, actorMemberId, operationId } = context;
    const [member] = await tx.select().from(schema.householdMembers).where(and(
      eq(schema.householdMembers.householdId, householdId), eq(schema.householdMembers.id, request.memberId),
    )).for("update");
    if (!member) throw new DomainError("NOT_FOUND");
    expectVersion(member.version, request.expectedVersion);
    if (member.status === "inactive") return { memberId: member.id, status: member.status, version: member.version };
    const active = await tx.select({ id: schema.householdMembers.id }).from(schema.householdMembers).where(and(
      eq(schema.householdMembers.householdId, householdId), eq(schema.householdMembers.status, "active"),
    ));
    if (active.length === 1) throw new DomainError("LAST_ACTIVE_MEMBER");
    const [updated] = await tx.update(schema.householdMembers).set({
      status: "inactive", version: member.version + 1, updatedAt: new Date(),
    }).where(and(eq(schema.householdMembers.householdId, householdId), eq(schema.householdMembers.id, member.id))).returning();
    await tx.insert(schema.auditEvents).values({ householdId, actorMemberId, operationId,
      entityType: "household_member", entityId: member.id, action: "member.deactivate",
      beforeData: { status: member.status, version: member.version }, afterData: { status: updated.status, version: updated.version } });
    return { memberId: updated.id, status: updated.status, version: updated.version };
  });
}
