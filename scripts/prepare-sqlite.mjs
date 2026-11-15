import { existsSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// Explicit environment variables take precedence; tests never load a local .env.
if (!process.env.DATABASE_URL && existsSync(path.join(root, ".env"))) {
  process.loadEnvFile(path.join(root, ".env"));
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith("file:")) {
  throw new Error("Set DATABASE_URL to a SQLite file URL. Start by copying .env.example to .env.");
}
const filename = decodeURIComponent(databaseUrl.slice(5).split("?")[0]);
if (!filename || filename === ":memory:") {
  throw new Error("Use a persistent SQLite file for the demo database.");
}
// Prisma resolves relative SQLite paths from the schema's directory.
const databasePath = path.resolve(root, "prisma", filename);
await mkdir(path.dirname(databasePath), { recursive: true });
// Append mode creates a missing database without truncating an existing one.
const file = await open(databasePath, "a");
await file.close();
console.log("SQLite file ready. Existing contents preserved.");
