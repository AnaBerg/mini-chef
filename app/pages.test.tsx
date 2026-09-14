import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import HomePage from "./page";
import SignInPage from "./sign-in/page";
import SignUpPage from "./sign-up/page";
import RootLayout from "./layout";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/font/google", () => ({ Inter: () => ({ variable: "font-inter" }) }));

describe("Public pages", () => {
  it("links visitors to sign-in and registration", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: "Mini Chef" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/sign-up");
  });

  it("renders sign-in without requiring a name", () => {
    render(<SignInPage />);
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("renders registration with a required name and password guidance", () => {
    render(<SignUpPage />);
    expect(screen.getByLabelText("Name")).toBeRequired();
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Use at least 8 characters.");
  });

  it("preserves page content inside an English document", () => {
    const document = new DOMParser().parseFromString(
      renderToStaticMarkup(<RootLayout><main>Page content</main></RootLayout>), "text/html",
    );
    expect(document.documentElement.lang).toBe("en");
    expect(document.body.querySelector("main")?.textContent).toBe("Page content");
  });
});
