import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain/commands";
import Page from "./page";
import Manager from "../households/[householdId]/invitations/page";
const list = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => ({}) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(path); } }));
vi.mock("@/lib/domain/server", () => ({ getDomainExecutor: () => ({}) }));
vi.mock("@/lib/domain/invitations", () => ({ listInvitations: list }));
vi.mock("@/components/private-boundary", () => ({ PrivateBoundary: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/invitation-forms", () => ({ InvitationEntry: () => <p>Entry</p>, InvitationManager: () => <p>Manager</p> }));
it("renders invitation entry and authorized invitation management", async () => {
  render(<Page />); expect(screen.getByText("Household invitation")).toBeVisible();
  list.mockResolvedValue([{ id: "invite", expiresAt: new Date() }]); render(await Manager({ params: Promise.resolve({ householdId: "home" }) })); expect(screen.getByText("Invite someone home")).toBeVisible();
});
it("redirects unauthenticated users, denies household data and propagates unexpected failures", async () => {
  const input = { params: Promise.resolve({ householdId: "home" }) };
  list.mockRejectedValue(new DomainError("UNAUTHENTICATED")); await expect(Manager(input)).rejects.toThrow("/sign-in");
  list.mockRejectedValue(new DomainError("ACCESS_DENIED")); render(await Manager(input)); expect(screen.getByText("Household unavailable")).toBeVisible();
  list.mockRejectedValue(new Error("unexpected")); await expect(Manager(input)).rejects.toThrow("unexpected");
});
