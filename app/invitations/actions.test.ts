import { beforeEach, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain/commands";
import { acceptInvitationAction, createInvitationAction, previewInvitationAction, revokeInvitationAction } from "./actions";
const mocks = vi.hoisted(() => ({ accept: vi.fn(), preview: vi.fn(), create: vi.fn(), revoke: vi.fn(), details: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/domain/server", () => ({ getDomainExecutor: () => ({}), getInvitationService: () => ({ accept: mocks.accept, preview: mocks.preview }) }));
vi.mock("@/lib/domain/households", () => ({ householdDetails: (...args: unknown[]) => mocks.details(...args) }));
vi.mock("@/lib/domain/invitations", () => ({ createInvitation: (...args: unknown[]) => mocks.create(...args), revokeInvitation: (...args: unknown[]) => mocks.revoke(...args) }));
beforeEach(() => vi.resetAllMocks());
it("returns only valid previews and safely hides exceptions", async () => {
  mocks.preview.mockResolvedValue({ name: "Kitchen" }); expect(await previewInvitationAction("secret")).toEqual({ preview: { name: "Kitchen" } });
  mocks.preview.mockRejectedValue(new Error("secret")); expect(await previewInvitationAction("secret")).toEqual({ preview: null });
});
it("checks current access after acceptance and never selects removed memberships", async () => {
  mocks.accept.mockResolvedValue({ householdId: "home", status: "active" }); expect(await acceptInvitationAction("secret", true)).toEqual({ householdId: "home" });
  mocks.details.mockRejectedValue(new DomainError("ACCESS_DENIED")); expect(await acceptInvitationAction("secret", true)).toEqual({ error: "ACCESS_DENIED" });
  mocks.accept.mockResolvedValue({ status: "inactive" }); expect(await acceptInvitationAction("secret", true)).toEqual({ error: "ACCESS_DENIED" });
  mocks.accept.mockRejectedValue(new Error("secret")); expect(await acceptInvitationAction("secret", true)).toEqual({ error: "UNEXPECTED" });
});
it("handles create and revoke outcomes without exposing error parameters", async () => {
  const input = { householdId: "home", idempotencyKey: "key", invitationId: "invite" };
  mocks.create.mockResolvedValue({ token: "secret" }); expect(await createInvitationAction(input)).toEqual({ token: "secret" });
  mocks.create.mockRejectedValue(new DomainError("ACCESS_DENIED")); expect(await createInvitationAction(input)).toEqual({ error: "ACCESS_DENIED" });
  mocks.create.mockRejectedValue(new Error()); expect(await createInvitationAction(input)).toEqual({ error: "UNEXPECTED" });
  expect(await revokeInvitationAction(input)).toEqual({ success: true });
  mocks.revoke.mockRejectedValue(new DomainError("NOT_FOUND")); expect(await revokeInvitationAction(input)).toEqual({ error: "NOT_FOUND" });
  mocks.revoke.mockRejectedValue(new Error()); expect(await revokeInvitationAction(input)).toEqual({ error: "UNEXPECTED" });
});
it("distinguishes missing authentication from an unavailable preview", async () => {
  mocks.preview.mockRejectedValue(new DomainError("UNAUTHENTICATED"));
  expect(await previewInvitationAction("secret")).toEqual({ preview: null, error: "UNAUTHENTICATED" });
});
