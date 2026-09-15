import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (table) => [index("session_user_id_idx").on(table.userId)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, (table) => [
  index("account_user_id_idx").on(table.userId),
  uniqueIndex("account_provider_account_idx").on(table.providerId, table.accountId),
]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

// New domain roots use UUIDs; authentication user identifiers remain text.
const rootColumns = () => ({
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  version: integer("version").default(1).notNull(),
});

export const households = pgTable("households", {
  ...rootColumns(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
}, (t) => [
  check("households_name_nonempty", sql`length(btrim(${t.name})) > 0`),
  check("households_version_positive", sql`${t.version} > 0`),
]);

export const householdMembers = pgTable("household_members", {
  ...rootColumns(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  status: text("status", { enum: ["active", "inactive"] }).default("active").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("household_members_tenant_id").on(t.householdId, t.id),
  unique("household_members_tenant_user").on(t.householdId, t.userId),
  index("household_members_user_idx").on(t.userId),
  check("household_members_status_valid", sql`${t.status} IN ('active', 'inactive')`),
  check("household_members_version_positive", sql`${t.version} > 0`),
]);

export const shoppingSettings = pgTable("shopping_settings", {
  ...rootColumns(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "restrict" }),
  includePlannedMeals: boolean("include_planned_meals").notNull(),
  planningHorizonDays: integer("planning_horizon_days").default(7).notNull(),
}, (t) => [
  unique("shopping_settings_household_unique").on(t.householdId),
  unique("shopping_settings_tenant_id").on(t.householdId, t.id),
  check("shopping_settings_horizon_positive", sql`${t.planningHorizonDays} > 0`),
  check("shopping_settings_version_positive", sql`${t.version} > 0`),
]);

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const domainOperations = pgTable("domain_operations", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  kind: text("kind").notNull(),
  actorMemberId: uuid("actor_member_id").notNull(),
  requestHash: text("request_hash").notNull(),
  result: jsonb("result").$type<JsonValue>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("domain_operations_tenant_id").on(t.householdId, t.id),
  unique("domain_operations_tenant_key").on(t.householdId, t.idempotencyKey),
  foreignKey({ name: "domain_operations_actor_tenant_fk", columns: [t.householdId, t.actorMemberId], foreignColumns: [householdMembers.householdId, householdMembers.id] }).onDelete("restrict"),
  check("domain_operations_key_nonempty", sql`length(btrim(${t.idempotencyKey})) BETWEEN 1 AND 200`),
  check("domain_operations_kind_nonempty", sql`length(btrim(${t.kind})) BETWEEN 1 AND 100`),
  check("domain_operations_hash_valid", sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`),
]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "restrict" }),
  operationId: uuid("operation_id"),
  actorMemberId: uuid("actor_member_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  beforeData: jsonb("before_data").$type<JsonValue>(),
  afterData: jsonb("after_data").$type<JsonValue>(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("audit_events_tenant_id").on(t.householdId, t.id),
  index("audit_events_household_occurred_idx").on(t.householdId, t.occurredAt),
  foreignKey({ name: "audit_events_actor_tenant_fk", columns: [t.householdId, t.actorMemberId], foreignColumns: [householdMembers.householdId, householdMembers.id] }).onDelete("restrict"),
  foreignKey({ name: "audit_events_operation_tenant_fk", columns: [t.householdId, t.operationId], foreignColumns: [domainOperations.householdId, domainOperations.id] }).onDelete("restrict"),
]);
