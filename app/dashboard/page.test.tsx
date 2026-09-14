import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ headers: vi.fn(), redirect: vi.fn(), getAuth: vi.fn(), getSession: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => <button>Sign out</button> }));
import DashboardPage from "./page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAuth.mockReturnValue({ api: { getSession: mocks.getSession } });
  mocks.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
});

it("redirects unauthenticated visitors to sign in", async () => {
  mocks.headers.mockResolvedValue(new Headers());
  mocks.getSession.mockResolvedValue(null);
  await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT");
  expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/sign-in");
});

it("awaits request headers before initializing auth and renders the authenticated user", async () => {
  let resolveHeaders!: (headers: Headers) => void;
  mocks.headers.mockReturnValue(new Promise<Headers>((resolve) => { resolveHeaders = resolve; }));
  mocks.getSession.mockResolvedValue({ user: { name: "Ana", email: "ana@example.com" } });
  const page = DashboardPage();
  expect(mocks.getAuth).not.toHaveBeenCalled();
  const headers = new Headers({ cookie: "session=example" });
  resolveHeaders(headers);
  render(await page);
  expect(mocks.getSession).toHaveBeenCalledExactlyOnceWith({ headers });
  expect(mocks.redirect).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Your kitchen" })).toBeInTheDocument();
  expect(screen.getByText("Welcome, Ana.")).toBeInTheDocument();
  expect(screen.getByText("ana@example.com")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
});
