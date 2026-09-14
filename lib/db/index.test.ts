import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ drizzle: vi.fn(), postgres: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: mocks.drizzle }));
vi.mock("postgres", () => ({ default: mocks.postgres }));
const dbGlobal = globalThis as typeof globalThis & { miniChefDb?: unknown };

beforeEach(() => {
  delete dbGlobal.miniChefDb;
  vi.resetModules();
  vi.resetAllMocks();
});
afterEach(() => {
  delete dbGlobal.miniChefDb;
  vi.unstubAllEnvs();
});

describe("getDb", () => {
  it("requires DATABASE_URL without creating a connection", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    const { getDb } = await import("./index");
    expect(() => getDb()).toThrow("DATABASE_URL is required.");
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it("lazily creates a bounded pool and reuses it across module reloads", async () => {
    const url = "postgres://test:test@localhost:5432/test";
    vi.stubEnv("DATABASE_URL", url);
    const client = {};
    const db = {};
    mocks.postgres.mockReturnValue(client);
    mocks.drizzle.mockReturnValue(db);
    const { getDb } = await import("./index");
    const schema = await import("./schema");
    expect(mocks.postgres).not.toHaveBeenCalled();
    expect(getDb()).toBe(db);
    expect(getDb()).toBe(db);
    vi.resetModules();
    expect((await import("./index")).getDb()).toBe(db);
    expect(mocks.postgres).toHaveBeenCalledExactlyOnceWith(url, { max: 10 });
    expect(mocks.drizzle).toHaveBeenCalledExactlyOnceWith(client, { schema });
  });
});
