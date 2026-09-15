import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), details: vi.fn(), deactivate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/domain/server", () => ({ getHouseholdService: () => ({ create: mocks.create }), getDomainExecutor: () => ({}) }));
vi.mock("@/lib/domain/households", async (original) => ({ ...await original<object>(), householdDetails: mocks.details }));
vi.mock("@/lib/domain/commands", async (original) => ({ ...await original<object>(), deactivateMember: mocks.deactivate }));
import { DomainError } from "@/lib/domain/commands";
import { createHouseholdAction, deactivateMemberAction } from "./actions";
const creation = { name: "Home", timezone: "UTC", includePlannedMeals: true, idempotencyKey: randomUUID() };
const removal = { householdId: randomUUID(), memberId: randomUUID(), expectedVersion: 1, idempotencyKey: randomUUID() };
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });
it("returns created households only when the current membership authorizes access", async () => {
  mocks.create.mockResolvedValue({ householdId: "home" });
  expect(await createHouseholdAction(creation)).toEqual({ householdId: "home" });
  expect(mocks.details).toHaveBeenCalledWith({}, "home");
  mocks.details.mockRejectedValue(new DomainError("ACCESS_DENIED"));
  expect(await createHouseholdAction(creation)).toEqual({ error: "ACCESS_DENIED" });
});
it("returns safe creation errors", async () => {
  mocks.create.mockRejectedValue(new DomainError("INVALID_INPUT"));
  expect(await createHouseholdAction(creation)).toEqual({ error: "INVALID_INPUT" });
  mocks.create.mockRejectedValue(new Error("database"));
  expect(await createHouseholdAction(creation)).toEqual({ error: "UNEXPECTED" });
});
it("validates IDs before passing membership commands to the trusted executor", async () => {
  expect(await deactivateMemberAction(removal)).toEqual({ success: true });
  expect(mocks.deactivate).toHaveBeenCalledWith({}, removal);
  for (const key of ["householdId", "memberId", "idempotencyKey"]) expect(await deactivateMemberAction({ ...removal, [key]: "invalid" })).toEqual({ error: "INVALID_INPUT" });
});
it("returns safe deactivation errors", async () => {
  mocks.deactivate.mockRejectedValue(new DomainError("VERSION_CONFLICT"));
  expect(await deactivateMemberAction(removal)).toEqual({ error: "VERSION_CONFLICT" });
  mocks.deactivate.mockRejectedValue(new Error("database"));
  expect(await deactivateMemberAction(removal)).toEqual({ error: "UNEXPECTED" });
});
