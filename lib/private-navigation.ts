export const sessionChannel = "mini-chef-session-change";
let replacingDocument = false;

export function isReplacingPrivateDocument() {
  return replacingDocument;
}

/** A new document discards the previous household's React tree and router cache. */
export function navigatePrivate(path: string) {
  replacingDocument = true;
  if ((path === "/sign-in" || path === "/dashboard" || path === "/households") && typeof BroadcastChannel !== "undefined") {
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
