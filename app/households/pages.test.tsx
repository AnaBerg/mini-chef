import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), details: vi.fn(), redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/domain/server", () => ({ getHouseholdService: () => ({ list: mocks.list }), getDomainExecutor: () => ({}) }));
vi.mock("@/lib/domain/households", () => ({ householdDetails: mocks.details }));
vi.mock("@/components/household-forms", () => ({ CreateHouseholdForm: () => <div>Create form</div>, DeactivateMemberButton: (props: { name: string; lastActive: boolean }) => <button disabled={props.lastActive}>Deactivate {props.name}</button> }));
import { DomainError } from "@/lib/domain/commands";
import HouseholdsPage from "./page";
import MembersPage from "./[householdId]/page";
const params = Promise.resolve({ householdId: "home" });
beforeEach(() => { vi.resetAllMocks(); mocks.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); }); });
it("shows empty households and creation", async () => {
  mocks.list.mockResolvedValue([]);
  render(await HouseholdsPage());
  expect(screen.getByText(/No active households yet/)).toBeInTheDocument();
  expect(screen.getByText("Create form")).toBeInTheDocument();
});
it("links active households to their members", async () => {
  mocks.list.mockResolvedValue([{ id: "home", name: "Home" }]);
  render(await HouseholdsPage());
  expect(screen.getByRole("link", { name: /Home/ })).toHaveAttribute("href", "/households/home");
});
it("redirects expired list sessions and propagates unexpected failures", async () => {
  mocks.list.mockRejectedValue(new DomainError("UNAUTHENTICATED"));
  await expect(HouseholdsPage()).rejects.toThrow("NEXT_REDIRECT");
  mocks.list.mockRejectedValue(new Error("database"));
  await expect(HouseholdsPage()).rejects.toThrow("database");
});
it("shows memberships and prevents last-active deactivation", async () => {
  mocks.details.mockResolvedValue({ name: "Home", timezone: "UTC", actorMemberId: "a", members: [{ id: "a", name: "Ana", status: "active", version: 1 }, { id: "b", name: "Ben", status: "inactive", version: 2 }] });
  render(await MembersPage({ params }));
  expect(screen.getByText("Ana (you)")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Deactivate Ana" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Deactivate Ben" })).not.toBeInTheDocument();
  expect(screen.getByText("UTC · 1 active member")).toBeInTheDocument();
});
it("allows equal member management when more than one active member remains", async () => {
  mocks.details.mockResolvedValue({ name: "Home", timezone: "UTC", actorMemberId: "a", members: [{ id: "a", name: "Ana", status: "active", version: 1 }, { id: "b", name: "Ben", status: "active", version: 1 }] });
  render(await MembersPage({ params }));
  expect(screen.getByRole("button", { name: "Deactivate Ben" })).toBeEnabled();
  expect(screen.getByText("UTC · 2 active members")).toBeInTheDocument();
});
it("shows unavailable access without leaking household data", async () => {
  mocks.details.mockRejectedValue(new DomainError("ACCESS_DENIED"));
  render(await MembersPage({ params }));
  expect(screen.getByRole("heading", { name: "Household unavailable" })).toBeInTheDocument();
});
it("redirects expired member sessions and propagates unexpected errors", async () => {
  mocks.details.mockRejectedValue(new DomainError("UNAUTHENTICATED"));
  await expect(MembersPage({ params })).rejects.toThrow("NEXT_REDIRECT");
  mocks.details.mockRejectedValue(new Error("database"));
  await expect(MembersPage({ params })).rejects.toThrow("database");
});
