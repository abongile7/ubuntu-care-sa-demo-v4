import { existsSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(path.join(root, ".env")))
  process.loadEnvFile(path.join(root, ".env"));
if (process.env.DATABASE_URL?.startsWith("file:")) {
  const [filename, query] = process.env.DATABASE_URL.slice(5).split("?");
  process.env.DATABASE_URL = `file:${path.resolve(root, "prisma", decodeURIComponent(filename))}${query ? `?${query}` : ""}`;
}
const port = 3000;
const localUrl = `http://127.0.0.1:${port}/login`;
const logPath = path.join(tmpdir(), "ubuntu-care-preview.log");
async function available() {
  try {
    const response = await fetch(localUrl, { signal: AbortSignal.timeout(2000) });
    return response.ok && (await response.text()).includes("UbuntuCare");
  } catch {
    return false;
  }
}
if (!(await available())) {
  const output = openSync(logPath, "a", 0o600);
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--hostname", "0.0.0.0", "--port", String(port)],
    {
      cwd: root,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      detached: true,
      stdio: ["ignore", output, output]
    }
  );
  await new Promise((resolve, reject) => {
    server.once("spawn", resolve);
    server.once("error", reject);
  });
  server.unref();
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await available()) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!(await available())) throw new Error(`The preview did not start. Check ${logPath}.`);
}
console.log(`Portal ready: ${localUrl}`);
if (process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
  console.log(
    `Open portal: https://${process.env.CODESPACE_NAME}-${port}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}/login`
  );
}
console.log(
  "In GitHub Codespaces, use Ports → 3000 → Open in Browser. The forwarded port is private by default."
);
