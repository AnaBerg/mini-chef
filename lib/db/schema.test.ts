import { getTableConfig } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { account, session, user, verification } from "./schema";

afterEach(() => vi.useRealTimers());

describe("authentication schema", () => {
  it("enforces unique identities and session tokens", () => {
    expect(user.id.primary).toBe(true);
    expect(user.email.isUnique).toBe(true);
    expect(user.email.notNull).toBe(true);
    expect(user.emailVerified.default).toBe(false);
    expect(session.token.isUnique).toBe(true);
    const providerAccount = getTableConfig(account).indexes.find(
      (index) => index.config.name === "account_provider_account_idx",
    );
    expect(providerAccount?.config.unique).toBe(true);
    expect(providerAccount?.config.columns).toEqual([
      expect.objectContaining({ name: "provider_id" }),
      expect.objectContaining({ name: "account_id" }),
    ]);
  });

  it.each([session, account])("cascades user deletion to dependent auth records", (table) => {
    const config = getTableConfig(table);
    expect(config.foreignKeys).toHaveLength(1);
    const foreignKey = config.foreignKeys[0];
    expect(foreignKey.onDelete).toBe("cascade");
    expect(foreignKey.reference().foreignTable).toBe(user);
    expect(foreignKey.reference().foreignColumns).toEqual([user.id]);
    expect(foreignKey.reference().columns).toEqual([table.userId]);
    expect(table.userId.notNull).toBe(true);
    expect(config.indexes[0].config.columns).toEqual([expect.objectContaining({ name: "user_id" })]);
  });

  it("indexes verification identifiers for token lookup", () => {
    expect(getTableConfig(verification).indexes[0].config.columns).toEqual([expect.objectContaining({ name: "identifier" })]);
    expect(verification.expiresAt.notNull).toBe(true);
  });

  it.each([user, session, account, verification])("refreshes updatedAt on auth record updates", (table) => {
    vi.useFakeTimers();
    const now = new Date("2026-09-14T12:00:00Z");
    vi.setSystemTime(now);
    expect(table.updatedAt.onUpdateFn?.()).toEqual(now);
  });
});

it("uses restrictive tenant references for every foundation domain table", async () => {
  const { households, householdMembers, shoppingSettings, domainOperations, auditEvents } = await import("./schema");
  for (const table of [householdMembers, shoppingSettings, domainOperations, auditEvents]) {
    const config = getTableConfig(table);
    expect(table.householdId.notNull).toBe(true);
    for (const reference of config.foreignKeys) {
      expect(reference.onDelete).toBe("restrict");
      const foreign = reference.reference();
      if (foreign.foreignTable !== households && foreign.foreignTable !== user) {
        expect(foreign.columns[0].name).toBe("household_id");
        expect(foreign.foreignColumns[0].name).toBe("household_id");
      }
    }
    expect(config.uniqueConstraints.some((constraint) => constraint.columns.length === 2
      && constraint.columns[0].name === "household_id" && constraint.columns[1].name === "id")).toBe(true);
  }
});
