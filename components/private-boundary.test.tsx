import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PrivateBoundary } from "./private-boundary";
const mocks = vi.hoisted(() => ({ reloadPrivate: vi.fn(), sessionChannel: "test-session", isReplacingPrivateDocument: vi.fn(() => false) }));
vi.mock("@/lib/private-navigation", () => mocks);
it("hides history snapshots and reloads restored documents before showing private content", () => {
  const { unmount } = render(<PrivateBoundary><p>Private household</p></PrivateBoundary>);
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
  expect(mocks.reloadPrivate).not.toHaveBeenCalled();
  expect(screen.getByText("Private household")).toBeVisible();
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  expect(screen.getByText("Private household")).not.toBeVisible();
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  expect(mocks.reloadPrivate).toHaveBeenCalledOnce();
  unmount();
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  expect(mocks.reloadPrivate).toHaveBeenCalledOnce();
});

it("revalidates HTTP history restoration and same-document history", () => {
  mocks.reloadPrivate.mockClear();
  const timing = vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type: "back_forward" } as PerformanceNavigationTiming]);
  const { unmount } = render(<PrivateBoundary><p>Hidden history</p></PrivateBoundary>);
  expect(screen.getByText("Hidden history")).not.toBeVisible();
  expect(mocks.reloadPrivate).toHaveBeenCalledOnce();
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(mocks.reloadPrivate).toHaveBeenCalledTimes(2);
  unmount();
  timing.mockRestore();
});

it("ignores its own broadcast while replacing the document but revalidates sibling changes", () => {
  mocks.reloadPrivate.mockClear();
  const channel: { onmessage: (() => void) | null; close: () => void } = { onmessage: null, close: vi.fn() };
  vi.stubGlobal("BroadcastChannel", vi.fn(function () { return channel; }));
  const { unmount } = render(<PrivateBoundary><p>Current household</p></PrivateBoundary>);
  mocks.isReplacingPrivateDocument.mockReturnValue(true);
  channel.onmessage!();
  expect(mocks.reloadPrivate).not.toHaveBeenCalled();
  mocks.isReplacingPrivateDocument.mockReturnValue(false);
  channel.onmessage!();
  expect(mocks.reloadPrivate).toHaveBeenCalledOnce();
  expect(screen.getByText("Current household")).not.toBeVisible();
  unmount();
  vi.unstubAllGlobals();
});
