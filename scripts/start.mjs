import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Next.js leaves public assets outside the standalone bundle.
cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
await import(pathToFileURL(resolve(".next/standalone/server.js")).href);
