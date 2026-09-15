import { createHash } from "node:crypto";
import { test as base, expect } from "@playwright/test";

export function clientHeaders(identity: string) {
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 8);
  // Documentation-only IPv6 addresses isolate real provider rate limits per client, including Better Auth's default /64 grouping.
  return { "x-forwarded-for": `2001:db8:${hash.slice(0, 4)}:${hash.slice(4)}::1` };
}

export const test = base.extend({
  extraHTTPHeaders: async ({}, provide, testInfo) => {
    await provide(clientHeaders(`${testInfo.testId}:${testInfo.retry}`));
  },
});
export { expect };
