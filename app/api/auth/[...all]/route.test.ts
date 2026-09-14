import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAuth: vi.fn(), toNextJsHandler: vi.fn(), GET: vi.fn(), POST: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler: mocks.toNextJsHandler }));
import { GET, POST, runtime } from "./route";

beforeEach(() => vi.resetAllMocks());

it.each([["GET", GET], ["POST", POST]] as const)("forwards %s requests and responses through Better Auth", async (method, handler) => {
  const auth = {};
  const request = new Request("http://localhost:3000/api/auth/session", { method });
  const response = new Response("auth response", { status: 201 });
  mocks.getAuth.mockReturnValue(auth);
  mocks.toNextJsHandler.mockReturnValue({ GET: mocks.GET, POST: mocks.POST });
  mocks[method].mockResolvedValue(response);
  expect(runtime).toBe("nodejs");
  expect(await handler(request)).toBe(response);
  expect(mocks.toNextJsHandler).toHaveBeenCalledExactlyOnceWith(auth);
  expect(mocks[method]).toHaveBeenCalledExactlyOnceWith(request);
});
