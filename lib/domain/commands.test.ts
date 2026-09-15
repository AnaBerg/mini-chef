import { describe, expect, it, vi } from "vitest";
import { canonicalJson, expectVersion, requestHash, validateTimezone, type JsonValue } from "./commands";

vi.mock("server-only", () => ({}));

describe("domain input conventions", () => {
  it("hashes canonical JSON independent of object order while preserving values and array order", () => {
    expect(canonicalJson({ z: [1, true, null, "value"], a: { b: false } })).toBe('{"a":{"b":false},"z":[1,true,null,"value"]}');
    expect(requestHash({ b: 2, a: 1 })).toBe(requestHash({ a: 1, b: 2 }));
    expect(requestHash([1, 2])).not.toBe(requestHash([2, 1]));
  });
  it.each([undefined, NaN, Infinity, new Date(), new Array(2), { missing: undefined }])("rejects lossy non-JSON input %s", (value) => {
    expect(() => canonicalJson(value as JsonValue)).toThrow("INVALID_INPUT");
  });
  it.each(["UTC", "America/Sao_Paulo", "Etc/GMT+3", "Etc/GMT-3"])("accepts supported timezone %s", (timezone) => {
    expect(() => validateTimezone(timezone)).not.toThrow();
  });
  it.each(["Invented/Zone", "PST", "+03:00", ""])("rejects unsupported or ambiguous timezone %s", (timezone) => {
    expect(() => validateTimezone(timezone)).toThrow("INVALID_INPUT");
  });
  it("requires a matching positive optimistic version", () => {
    expect(() => expectVersion(1, 1)).not.toThrow();
    expect(() => expectVersion(2, 1)).toThrow("VERSION_CONFLICT");
    expect(() => expectVersion(1, 0)).toThrow("INVALID_INPUT");
    expect(() => expectVersion(1, 1.5)).toThrow("INVALID_INPUT");
  });
});
