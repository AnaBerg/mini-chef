import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { InvitationEntry, InvitationManager } from "./invitation-forms";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), accept: vi.fn(), create: vi.fn(), revoke: vi.fn(), navigate: vi.fn() }));
vi.mock("@/app/invitations/actions", () => ({ previewInvitationAction: mocks.preview, acceptInvitationAction: mocks.accept, createInvitationAction: mocks.create, revokeInvitationAction: mocks.revoke }));
vi.mock("@/lib/private-navigation", () => ({ navigatePrivate: mocks.navigate }));
beforeEach(() => { vi.clearAllMocks(); window.history.replaceState(null, "", `/invitations#${"a".repeat(43)}`); });
it("previews, requires explicit consent and navigates only after active acceptance", async () => {
  mocks.preview.mockResolvedValue({ preview: { name: "Kitchen A" } }); mocks.accept.mockResolvedValue({ householdId: "home" });
  render(<InvitationEntry />); const user = userEvent.setup();
  await user.click(screen.getByText("Preview invitation")); expect(screen.getByText("Kitchen A")).toBeVisible(); expect(mocks.accept).not.toHaveBeenCalled();
  await user.click(screen.getByText("Accept invitation and join")); expect(mocks.accept).toHaveBeenCalledWith("a".repeat(43), true, false); expect(mocks.navigate).toHaveBeenCalledWith("/households/home");
});
it("preserves auth continuation and allows read-only accepted retries without preview", async () => {
  mocks.accept.mockResolvedValue({ error: "UNAUTHENTICATED" }); render(<InvitationEntry />);
  const user = userEvent.setup(); await user.click(screen.getByText("Check previous acceptance"));
  expect(mocks.accept).toHaveBeenCalledWith("a".repeat(43), true, true);
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/sign-in#${"a".repeat(43)}`);
  expect(screen.getByRole("alert")).toHaveTextContent("Sign in or create");
  mocks.accept.mockResolvedValue({ error: "ACCESS_DENIED" }); await user.click(screen.getByText("Check previous acceptance")); expect(screen.getByRole("alert")).toHaveTextContent("new invitation");
  mocks.accept.mockResolvedValue({ error: "NOT_FOUND" }); await user.click(screen.getByText("Check previous acceptance")); expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
});
it("drops stale previews on fragment changes and handles invalid links and network failures", async () => {
  const user = userEvent.setup(); mocks.preview.mockResolvedValue({ preview: { name: "Kitchen A" } }); render(<InvitationEntry />);
  await user.click(screen.getByText("Preview invitation"));
  window.history.replaceState(null, "", `/invitations#${"b".repeat(43)}`); fireEvent(window, new Event("hashchange"));
  expect(screen.queryByText("Kitchen A")).not.toBeInTheDocument(); expect(screen.queryByText("Accept invitation and join")).not.toBeInTheDocument();
  mocks.preview.mockResolvedValue({ preview: null }); await user.click(screen.getByText("Preview invitation")); expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
  mocks.preview.mockRejectedValue(new Error()); await user.click(screen.getByText("Preview invitation")); expect(screen.getByRole("alert")).toHaveTextContent("Unable to connect");
  window.history.replaceState(null, "", "/invitations"); fireEvent(window, new Event("hashchange")); expect(screen.getByRole("alert")).toHaveTextContent("complete invitation");
});
it("creates one-time links, displays replay recovery, revokes and handles failures", async () => {
  const user = userEvent.setup(); mocks.create.mockResolvedValue({ invitationId: "invite", token: "a".repeat(43), expiresAt: "2030-01-01" }); mocks.revoke.mockResolvedValue({ success: true });
  render(<InvitationManager householdId="home" invitations={[]} />);
  await user.click(screen.getByText("Create invitation link")); expect(screen.getByLabelText("Your invitation link")).toHaveValue(`${window.location.origin}/invitations#${"a".repeat(43)}`);
  fireEvent.focus(screen.getByLabelText("Your invitation link"));
  mocks.create.mockResolvedValue({ invitationId: "invite", token: null, expiresAt: "2030-01-01" }); await user.click(screen.getByText("Create invitation link")); expect(screen.getByRole("alert")).toHaveTextContent("cannot be recovered");
  mocks.revoke.mockResolvedValue({ error: "NOT_FOUND" }); await user.click(screen.getByText("Revoke")); expect(screen.getByRole("alert")).toHaveTextContent("Unable to revoke");
  mocks.revoke.mockRejectedValue(new Error()); await user.click(screen.getByText("Revoke")); expect(screen.getByRole("alert")).toHaveTextContent("Unable to connect");
  mocks.revoke.mockResolvedValue({ success: true }); await user.click(screen.getByText("Revoke")); expect(screen.queryByText("Revoke")).not.toBeInTheDocument();
  mocks.create.mockRejectedValue(new Error()); await user.click(screen.getByText("Create invitation link")); const key = mocks.create.mock.lastCall![0].idempotencyKey;
  mocks.create.mockResolvedValue({ error: "ACCESS_DENIED" }); await user.click(screen.getByText("Create invitation link")); expect(mocks.create.mock.lastCall![0].idempotencyKey).toBe(key); expect(screen.getByRole("alert")).toHaveTextContent("Unable to create");
});
it("asks anonymous visitors to authenticate before preview instead of claiming an invalid link", async () => {
  mocks.preview.mockResolvedValue({ preview: null, error: "UNAUTHENTICATED" });
  render(<InvitationEntry />); await userEvent.setup().click(screen.getByText("Preview invitation"));
  expect(screen.getByRole("alert")).toHaveTextContent("Sign in or create an account");
});
