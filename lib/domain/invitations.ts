import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import { type AuthenticatedSession, type DomainDatabase, type DomainExecutor, DomainError, requestHash, requireSession } from "./commands";
import { isUuid } from "./households";

function tokenHash(token: string) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DomainError("NOT_FOUND");
  return createHash("sha256").update(token).digest("hex");
}
export async function createInvitation(executor: DomainExecutor, input: { householdId: string; idempotencyKey: string }) {
  if (!isUuid(input.householdId) || !isUuid(input.idempotencyKey)) throw new DomainError("INVALID_INPUT");
  // The secret exists only in this invocation. Kernel replay returns public metadata only.
  let secret: string | null = null;
  const result = await executor.execute({ ...input, kind: "invitation.create", input: {} }, async ({ tx, householdId, actorMemberId }) => {
    secret = randomBytes(32).toString("base64url");
    const [invite] = await tx.insert(s.householdInvitations).values({ householdId, createdByMemberId: actorMemberId, tokenHash: tokenHash(secret), expiresAt: sql`clock_timestamp() + interval '7 days'` }).returning();
    return { invitationId: invite.id, expiresAt: invite.expiresAt.toISOString() };
  });
  return { ...result, token: secret };
}
export async function listInvitations(executor: DomainExecutor, householdId: string) {
  if (!isUuid(householdId)) throw new DomainError("ACCESS_DENIED");
  return executor.read(householdId, ({ tx }) => tx.select({ id: s.householdInvitations.id, expiresAt: s.householdInvitations.expiresAt, createdAt: s.householdInvitations.createdAt }).from(s.householdInvitations).where(and(eq(s.householdInvitations.householdId, householdId), isNull(s.householdInvitations.acceptedAt), isNull(s.householdInvitations.revokedAt))).orderBy(desc(s.householdInvitations.createdAt)));
}
export async function revokeInvitation(executor: DomainExecutor, input: { householdId: string; invitationId: string; idempotencyKey: string }) {
  if (!isUuid(input.householdId) || !isUuid(input.invitationId) || !isUuid(input.idempotencyKey)) throw new DomainError("INVALID_INPUT");
  return executor.execute({ ...input, kind: "invitation.revoke", input: { invitationId: input.invitationId } }, async ({ tx, householdId }) => {
    const [invite] = await tx.select().from(s.householdInvitations).where(and(eq(s.householdInvitations.householdId, householdId), eq(s.householdInvitations.id, input.invitationId))).for("update");
    if (!invite || invite.acceptedAt) throw new DomainError("NOT_FOUND");
    if (!invite.revokedAt) await tx.update(s.householdInvitations).set({ revokedAt: new Date(), updatedAt: new Date(), version: invite.version + 1 }).where(and(eq(s.householdInvitations.householdId, householdId), eq(s.householdInvitations.id, invite.id)));
    return { invitationId: invite.id };
  });
}
export function createInvitationService(db: DomainDatabase, resolveSession: () => Promise<AuthenticatedSession | null>) {
  return {
    async preview(token: string) {
      const identity = await resolveSession();
      if (!identity) throw new DomainError("UNAUTHENTICATED");
      const hash = tokenHash(token);
      return db.transaction(async (tx) => {
        const [anchor] = await tx.select().from(s.householdInvitations).where(eq(s.householdInvitations.tokenHash, hash));
        if (!anchor) { await requireSession(tx, identity); return null; }
        const householdId = anchor.householdId;
        await tx.select().from(s.households).where(eq(s.households.id, householdId)).for("share");
        await tx.select().from(s.householdMembers).where(and(eq(s.householdMembers.householdId, householdId), eq(s.householdMembers.id, anchor.createdByMemberId))).for("share");
        await tx.select().from(s.householdInvitations).where(and(eq(s.householdInvitations.householdId, householdId), eq(s.householdInvitations.id, anchor.id))).for("share");
        await requireSession(tx, identity);
        const [preview] = await tx.select({ name: s.households.name }).from(s.householdInvitations)
          .innerJoin(s.households, eq(s.households.id, s.householdInvitations.householdId))
          .innerJoin(s.householdMembers, and(eq(s.householdMembers.householdId, s.householdInvitations.householdId), eq(s.householdMembers.id, s.householdInvitations.createdByMemberId)))
          .where(and(eq(s.householdInvitations.householdId, householdId), eq(s.householdInvitations.id, anchor.id), eq(s.householdInvitations.tokenHash, hash), isNull(s.householdInvitations.acceptedAt), isNull(s.householdInvitations.revokedAt), sql`${s.householdInvitations.expiresAt} > clock_timestamp()`, eq(s.householdMembers.status, "active")));
        await requireSession(tx, identity);
        return preview ?? null;
      });
    },
    async accept(token: string, consent: boolean, retryOnly = false) {
      const identity = await resolveSession();
      if (!identity) throw new DomainError("UNAUTHENTICATED");
      if (consent !== true) throw new DomainError("INVALID_INPUT");
      const hash = tokenHash(token);
      return db.transaction(async (tx) => {
        const [anchor] = await tx.select().from(s.householdInvitations).where(eq(s.householdInvitations.tokenHash, hash));
        if (!anchor) throw new DomainError("NOT_FOUND");
        const householdId = anchor.householdId;
        await tx.select().from(s.households).where(eq(s.households.id, householdId)).for("update");
        const [creator] = await tx.select().from(s.householdMembers).where(and(eq(s.householdMembers.householdId, householdId), eq(s.householdMembers.id, anchor.createdByMemberId))).for("share");
        const [invite] = await tx.select().from(s.householdInvitations).where(and(eq(s.householdInvitations.householdId, householdId), eq(s.householdInvitations.id, anchor.id))).for("update");
        await requireSession(tx, identity);
        const [existing] = await tx.select().from(s.householdMembers).where(and(eq(s.householdMembers.householdId, householdId), eq(s.householdMembers.userId, identity.userId))).for("update");
        if (invite.acceptedAt) {
          if (invite.acceptedByUserId !== identity.userId || !existing) throw new DomainError("NOT_FOUND");
          await requireSession(tx, identity);
          return { householdId, memberId: existing.id, status: existing.status, acceptedAt: invite.acceptedAt.toISOString() };
        }
        if (retryOnly) throw new DomainError("NOT_FOUND");
        const [valid] = await tx.select({ id: s.householdInvitations.id }).from(s.householdInvitations).where(and(eq(s.householdInvitations.id, invite.id), eq(s.householdInvitations.householdId, householdId), sql`${s.householdInvitations.expiresAt} > clock_timestamp()`));
        if (!valid || invite.revokedAt || creator.status !== "active") throw new DomainError("NOT_FOUND");
        let member = existing;
        if (!member) [member] = await tx.insert(s.householdMembers).values({ householdId, userId: identity.userId }).returning();
        else if (member.status === "inactive") [member] = await tx.update(s.householdMembers).set({ status: "active", updatedAt: new Date(), version: member.version + 1 }).where(and(eq(s.householdMembers.householdId, householdId), eq(s.householdMembers.id, member.id))).returning();
        const acceptedAt = new Date();
        const result = { householdId, memberId: member.id, status: member.status, acceptedAt: acceptedAt.toISOString() };
        const operationId = randomUUID();
        await tx.insert(s.domainOperations).values({ id: operationId, householdId, actorMemberId: member.id, kind: "invitation.accept", idempotencyKey: `invitation.accept:${invite.id}`, requestHash: requestHash({ invitationId: invite.id, userId: identity.userId }), result });
        await tx.insert(s.auditEvents).values({ householdId, actorMemberId: member.id, operationId, entityType: "household_invitation", entityId: invite.id, action: "invitation.accept", afterData: { memberId: member.id } });
        await tx.update(s.householdInvitations).set({ acceptedAt, acceptedByUserId: identity.userId, updatedAt: acceptedAt, version: invite.version + 1 }).where(and(eq(s.householdInvitations.householdId, householdId), eq(s.householdInvitations.id, invite.id)));
        await requireSession(tx, identity);
        return result;
      });
    },
  };
}
