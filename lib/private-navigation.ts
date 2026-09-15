export const sessionChannel = "mini-chef-session-change";

/** A new document discards the previous household's React tree and router cache. */
export function navigatePrivate(path: string) {
  if ((path === "/sign-in" || path === "/dashboard") && typeof BroadcastChannel !== "undefined") {
    // Only an invalidation signal is shared; account/session data never enters storage.
    const channel = new BroadcastChannel(sessionChannel);
    channel.postMessage(null);
    channel.close();
  }
  window.location.replace(path);
}

export function reloadPrivate() {
  window.location.reload();
}
