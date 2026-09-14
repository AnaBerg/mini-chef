import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/lib/db/schema";

function createDb() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is required.");
  }

  return drizzle(postgres(url, { max: 10 }), { schema });
}

const globalForDb = globalThis as typeof globalThis & {
  miniChefDb?: ReturnType<typeof createDb>;
};

export function getDb() {
  return (globalForDb.miniChefDb ??= createDb());
}
