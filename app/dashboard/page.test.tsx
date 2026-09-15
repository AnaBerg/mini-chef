import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ headers: vi.fn(), redirect: vi.fn(), list: vi.fn(), service: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/domain/server", () => ({ getHouseholdService: mocks.service }));
import { DomainError } from "@/lib/domain/commands";
import DashboardPage from "./page";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.service.mockReturnValue({ list: mocks.list });
  mocks.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
});
it.each([
  [[], "/households"],
  [[{ id: "one" }], "/households/one"],
  [[{ id: "one" }, { id: "two" }], "/households"],
])("routes by current active membership count", async (homes, destination) => {
  mocks.list.mockResolvedValue(homes);
  await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT");
  expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(destination);
});
it("resolves request context before initializing the service", async () => {
  let finish!: () => void;
  mocks.headers.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  mocks.list.mockResolvedValue([]);
  const result = DashboardPage();
  expect(mocks.service).not.toHaveBeenCalled();
  finish();
  await expect(result).rejects.toThrow("NEXT_REDIRECT");
});
it("redirects expired sessions and propagates unexpected failures", async () => {
  mocks.list.mockRejectedValue(new DomainError("UNAUTHENTICATED"));
  await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT");
  expect(mocks.redirect).toHaveBeenCalledWith("/sign-in");
  mocks.list.mockRejectedValue(new Error("database"));
  await expect(DashboardPage()).rejects.toThrow("database");
});
