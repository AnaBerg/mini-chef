import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), deactivate: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/app/households/actions", () => ({ createHouseholdAction: mocks.create, deactivateMemberAction: mocks.deactivate }));
import { CreateHouseholdForm, DeactivateMemberButton } from "./household-forms";
beforeEach(() => vi.resetAllMocks());
async function completeForm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Household name"), "Our kitchen");
  await user.click(screen.getByLabelText("No, use consumption only"));
  return user;
}
it("requires explicit shopping inclusion and submits a UUID with the household details", async () => {
  mocks.create.mockResolvedValue({ householdId: "home" });
  render(<CreateHouseholdForm />);
  expect(screen.getByLabelText("Yes, include planned meals")).not.toBeChecked();
  expect(screen.getByLabelText("No, use consumption only")).not.toBeChecked();
  const user = await completeForm();
  await user.click(screen.getByRole("button", { name: "Create household" }));
  expect(mocks.create).toHaveBeenCalledWith({ name: "Our kitchen", timezone: "UTC", includePlannedMeals: false, idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(mocks.push).toHaveBeenCalledWith("/households/home");
});
it("retains the key after a failed request and uses a new key when input changes", async () => {
  mocks.create.mockRejectedValueOnce(new Error("network")).mockResolvedValue({ error: "INVALID_INPUT" });
  render(<CreateHouseholdForm />);
  const user = await completeForm();
  await user.click(screen.getByRole("button", { name: "Create household" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  await user.click(screen.getByRole("button", { name: "Create household" }));
  expect(mocks.create.mock.calls[0][0].idempotencyKey).toBe(mocks.create.mock.calls[1][0].idempotencyKey);
  expect(screen.getByRole("alert")).toHaveTextContent("supported IANA timezone");
  await user.click(screen.getByLabelText("Yes, include planned meals"));
  await user.click(screen.getByRole("button", { name: "Create household" }));
  expect(mocks.create.mock.calls[2][0].idempotencyKey).not.toBe(mocks.create.mock.calls[0][0].idempotencyKey);
  expect(mocks.create.mock.calls[2][0].includePlannedMeals).toBe(true);
});
it("disables creation during the request", async () => {
  let finish!: (value: object) => void;
  mocks.create.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<CreateHouseholdForm />);
  const user = await completeForm();
  await user.click(screen.getByRole("button", { name: "Create household" }));
  expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  finish({ error: "ACCESS_DENIED" });
  await screen.findByText("You no longer have access to this household.");
});
const props = { householdId: "home", memberId: "member", expectedVersion: 2, name: "Sam", self: false, lastActive: false };
it("explains why the last active member cannot be deactivated", () => {
  render(<DeactivateMemberButton {...props} lastActive />);
  expect(screen.getByText(/Another account must join/)).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("confirms membership deactivation, preserves the submitted version and refreshes members", async () => {
  mocks.deactivate.mockResolvedValue({ success: true });
  render(<DeactivateMemberButton {...props} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Deactivate Sam" }));
  expect(screen.getByText(/History will be preserved/)).toHaveTextContent("They will lose access");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.deactivate).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Deactivate Sam" }));
  await user.click(screen.getByRole("button", { name: "Confirm deactivation" }));
  expect(mocks.deactivate).toHaveBeenCalledWith(expect.objectContaining({ householdId: "home", memberId: "member", expectedVersion: 2 }));
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
it("returns to households after self-deactivation", async () => {
  mocks.deactivate.mockResolvedValue({ success: true });
  render(<DeactivateMemberButton {...props} self />);
  fireEvent.click(screen.getByRole("button", { name: "Deactivate your membership" }));
  expect(screen.getByText(/You will lose access/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Confirm deactivation" }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/households"));
});
it("requires reloading and fresh confirmation after a version conflict", async () => {
  mocks.deactivate.mockResolvedValue({ error: "VERSION_CONFLICT" });
  render(<DeactivateMemberButton {...props} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Deactivate Sam" }));
  await user.click(screen.getByRole("button", { name: "Confirm deactivation" }));
  expect(screen.getByRole("alert")).toHaveTextContent("This membership changed");
  expect(screen.getByRole("button", { name: "Confirm deactivation" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reload membership" })).toBeInTheDocument();
});
it("keeps a retry key after transient membership failure and displays domain errors", async () => {
  mocks.deactivate.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ error: "LAST_ACTIVE_MEMBER" });
  render(<DeactivateMemberButton {...props} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Deactivate Sam" }));
  await user.click(screen.getByRole("button", { name: "Confirm deactivation" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  await user.click(screen.getByRole("button", { name: "Confirm deactivation" }));
  expect(screen.getByRole("alert")).toHaveTextContent("last active member");
  expect(mocks.deactivate.mock.calls[0][0].idempotencyKey).toBe(mocks.deactivate.mock.calls[1][0].idempotencyKey);
});
