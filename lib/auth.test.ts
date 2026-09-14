import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn(),
  drizzleAdapter: vi.fn(),
  getDb: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("better-auth", () => ({ betterAuth: mocks.betterAuth }));
vi.mock("@better-auth/drizzle-adapter", () => ({ drizzleAdapter: mocks.drizzleAdapter }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(32));
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
});

afterEach(() => vi.unstubAllEnvs());

describe("getAuth", () => {
  it.each([undefined, "", "short"])("rejects an invalid secret (%s) before opening a database", async (secret) => {
    vi.stubEnv("BETTER_AUTH_SECRET", secret);
    const { getAuth } = await import("./auth");
    expect(() => getAuth()).toThrow("BETTER_AUTH_SECRET must contain at least 32 characters.");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("requires a base URL", async () => {
    vi.stubEnv("BETTER_AUTH_URL", undefined);
    const { getAuth } = await import("./auth");
    expect(() => getAuth()).toThrow("BETTER_AUTH_URL is required.");
    expect(mocks.betterAuth).not.toHaveBeenCalled();
  });

  it("lazily initializes and caches email/password auth with the PostgreSQL adapter", async () => {
    const db = {};
    const adapter = {};
    const auth = { api: {} };
    mocks.getDb.mockReturnValue(db);
    mocks.drizzleAdapter.mockReturnValue(adapter);
    mocks.betterAuth.mockReturnValue(auth);
    const { getAuth } = await import("./auth");
    const schema = await import("./db/schema");
    expect(mocks.betterAuth).not.toHaveBeenCalled();
    expect(getAuth()).toBe(auth);
    expect(getAuth()).toBe(auth);
    expect(mocks.drizzleAdapter).toHaveBeenCalledExactlyOnceWith(db, { provider: "pg", schema });
    expect(mocks.betterAuth).toHaveBeenCalledExactlyOnceWith({
      appName: "Mini Chef",
      baseURL: "http://localhost:3000",
      secret: "s".repeat(32),
      database: adapter,
      emailAndPassword: { enabled: true },
    });
  });
});
