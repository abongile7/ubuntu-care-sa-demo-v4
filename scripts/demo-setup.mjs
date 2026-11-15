import { constants, existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const environmentFile = path.join(root, ".env");
if (!process.env.DATABASE_URL && !existsSync(environmentFile)) {
  await copyFile(path.join(root, ".env.example"), environmentFile, constants.COPYFILE_EXCL);
}
if (!process.env.DATABASE_URL && existsSync(environmentFile)) process.loadEnvFile(environmentFile);
if (process.env.DATABASE_URL?.startsWith("file:")) {
  const [filename, query] = process.env.DATABASE_URL.slice(5).split("?");
  process.env.DATABASE_URL = `file:${path.resolve(root, "prisma", decodeURIComponent(filename))}${query ? `?${query}` : ""}`;
}
if (process.env.NODE_ENV === "production")
  throw new Error(
    "Use the documented deployment process; demo:setup is for disposable development previews."
  );

function run(args) {
  execFileSync(process.execPath, args, { cwd: root, env: process.env, stdio: "inherit" });
}
run(["scripts/prepare-sqlite.mjs"]);
run(["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"]);
const { PrismaClient } = await import("@prisma/client");
const database = new PrismaClient();
let users;
try {
  users = await database.user.count();
} finally {
  await database.$disconnect();
}
if (users === 0) {
  run(["--import", "tsx", "prisma/seed.ts"]);
  console.log("Fictional demo data created. Shared demo accounts use Demo123!.");
} else {
  console.log("Existing records preserved. No reseeding was performed.");
}
console.log("Next: npm run demo:start, then open port 3000 /login.");
