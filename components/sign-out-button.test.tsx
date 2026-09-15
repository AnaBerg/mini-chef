import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignOutButton } from "./sign-out-button";

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: mocks.signOut } }));
vi.mock("@/lib/private-navigation", () => ({ navigatePrivate: mocks.push }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));

describe("SignOutButton", () => {
  beforeEach(() => vi.resetAllMocks());

  it("prevents duplicate clicks until sign-out completes, then replaces the private document", async () => {
    let finish!: (result: { error: null }) => void;
    mocks.signOut.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<SignOutButton />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    const pending = screen.getByRole("button", { name: "Signing out…" });
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => finish({ error: null }));
    expect(mocks.push).toHaveBeenCalledWith("/sign-in");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ["Session unavailable", "Sign-out is unconfirmed. Please try again."],
    ["", "Sign-out is unconfirmed. Please try again."],
  ])("shows a server error and leaves the session in place (%s)", async (message, expected) => {
    mocks.signOut.mockResolvedValue({ error: { message } });
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("alert")).toHaveTextContent(expected);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("allows retry after a network failure and clears the error", async () => {
    mocks.signOut.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({ error: null });
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-out is unconfirmed. Check your connection and try again.");
    expect(mocks.push).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.push).toHaveBeenCalledWith("/sign-in");
  });
});
