import { afterEach, expect, it, vi } from "vitest";
import { navigatePrivate, reloadPrivate, sessionChannel } from "./private-navigation";
afterEach(() => vi.unstubAllGlobals());
it("replaces auth documents and invalidates other tabs without transmitting private data", () => {
  const replace = vi.fn();
  const postMessage = vi.fn();
  const close = vi.fn();
  const constructor = vi.fn();
  vi.stubGlobal("window", { location: { replace } });
  vi.stubGlobal("BroadcastChannel", class { postMessage = postMessage; close = close; constructor(name: string) { constructor(name); } });
  navigatePrivate("/sign-in");
  navigatePrivate("/dashboard");
  expect(constructor).toHaveBeenCalledWith(sessionChannel);
  expect(postMessage).toHaveBeenCalledWith(null);
  expect(close).toHaveBeenCalledTimes(2);
  navigatePrivate("/households/one");
  expect(close).toHaveBeenCalledTimes(2);
  expect(replace).toHaveBeenLastCalledWith("/households/one");
});
it("still navigates when cross-tab notifications are unsupported and reloads through the server", () => {
  const replace = vi.fn();
  const reload = vi.fn();
  vi.stubGlobal("window", { location: { replace, reload } });
  vi.stubGlobal("BroadcastChannel", undefined);
  navigatePrivate("/sign-in");
  expect(replace).toHaveBeenCalledWith("/sign-in");
  reloadPrivate();
  expect(reload).toHaveBeenCalledOnce();
});
