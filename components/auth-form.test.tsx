import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthForm } from "@/components/auth-form";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: mocks.signIn },
    signUp: { email: mocks.signUp },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

async function fillCredentials() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), "chef@example.com");
  await user.type(screen.getByLabelText("Password"), "a-secure-password");
  return user;
}

describe("AuthForm", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("signs in and refreshes the protected destination", async () => {
    mocks.signIn.mockResolvedValue({ data: {}, error: null });
    render(<AuthForm mode="sign-in" />);
    const user = await fillCredentials();
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(mocks.signIn).toHaveBeenCalledWith({ email: "chef@example.com", password: "a-secure-password" });
    expect(mocks.push).toHaveBeenCalledWith("/dashboard");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("sends the name when creating an account", async () => {
    mocks.signUp.mockResolvedValue({ data: {}, error: null });
    render(<AuthForm mode="sign-up" />);
    const user = await fillCredentials();
    await user.type(screen.getByLabelText("Name"), "  Ana  ");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(mocks.signUp).toHaveBeenCalledWith({ name: "Ana", email: "chef@example.com", password: "a-secure-password" });
    expect(mocks.push).toHaveBeenCalledWith("/dashboard");
  });

  it("shows authentication errors without navigating and permits retry", async () => {
    mocks.signIn.mockResolvedValue({ error: { message: "Invalid email or password" } });
    render(<AuthForm mode="sign-in" />);
    const user = await fillCredentials();
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("provides a fallback when the server error has no message", async () => {
    mocks.signIn.mockResolvedValue({ error: { message: "" } });
    render(<AuthForm mode="sign-in" />);
    const user = await fillCredentials();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't complete your request. Please try again.");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("disables submission while waiting and prevents duplicate requests", async () => {
    let resolveRequest!: (value: { error: null }) => void;
    mocks.signIn.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    render(<AuthForm mode="sign-in" />);
    const user = await fillCredentials();
    const button = screen.getByRole("button", { name: "Sign in" });
    await user.click(button);

    expect(screen.getByRole("button", { name: "Please wait…" })).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    fireEvent.submit(button.closest("form")!);
    expect(mocks.signIn).toHaveBeenCalledOnce();

    await act(async () => { resolveRequest({ error: null }); });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard"));
  });

  it("recovers from network failures and clears the error on a successful retry", async () => {
    mocks.signIn.mockRejectedValueOnce(new Error("Network unavailable"));
    mocks.signIn.mockResolvedValueOnce({ error: null });
    render(<AuthForm mode="sign-in" />);
    const user = await fillCredentials();
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to connect. Check your connection and try again.");
    expect(mocks.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.push).toHaveBeenCalledWith("/dashboard");
  });
});
