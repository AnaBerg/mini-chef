import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), headers: vi.fn(), getDb: vi.fn(), createDomainExecutor: vi.fn(), createHouseholdService: vi.fn(), createInvitationService: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("./commands", () => ({ createDomainExecutor: mocks.createDomainExecutor }));
vi.mock("./households", () => ({ createHouseholdService: mocks.createHouseholdService }));
vi.mock("./invitations", () => ({ createInvitationService: mocks.createInvitationService }));
import { getDomainExecutor, getHouseholdService, getInvitationService } from "./server";

beforeEach(() => vi.resetAllMocks());
it("derives command identity from the current Better Auth session and server headers", async () => {
  const headers = new Headers({ cookie: "test-session" });
  const database = {}; const executor = {};
  mocks.headers.mockResolvedValue(headers);
  mocks.getDb.mockReturnValue(database);
  mocks.createDomainExecutor.mockReturnValue(executor);
  mocks.getSession.mockResolvedValue({ session: { id: "session" }, user: { id: "user" } });
  expect(getDomainExecutor()).toBe(executor);
  const [db, resolver] = mocks.createDomainExecutor.mock.calls[0];
  expect(db).toBe(database);
  expect(await resolver()).toEqual({ id: "session", userId: "user" });
  expect(mocks.getSession).toHaveBeenCalledWith({ headers });
  mocks.getSession.mockResolvedValue(null);
  expect(await resolver()).toBeNull();
});

it("derives bootstrap identity from server auth rather than input", async () => {
  mocks.getSession.mockResolvedValue({ session: { id: "session" }, user: { id: "user" } });
  getHouseholdService();
  const resolver = mocks.createHouseholdService.mock.calls[0][1];
  expect(await resolver()).toEqual({ id: "session", userId: "user" });
  mocks.getSession.mockResolvedValue(null);
  expect(await resolver()).toBeNull();
});

it("derives invitation identity from the provider session", async () => {
  mocks.getSession.mockResolvedValue({ session: { id: "session" }, user: { id: "user" } });
  getInvitationService();
  const resolver = mocks.createInvitationService.mock.calls[0][1];
  expect(await resolver()).toEqual({ id: "session", userId: "user" });
  mocks.getSession.mockResolvedValue(null);
  expect(await resolver()).toBeNull();
});
