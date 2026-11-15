import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

const run = promisify(execFile);
const projectRoot = process.cwd();
let temporaryDirectory: string | undefined;
let server: ChildProcess | undefined;
let database: PrismaClient;
let baseUrl: string;
let serverLog = "";
let patientId: string;
let otherPatientId: string;
const cookies: Record<string, string> = {};

type Dashboard = {
  cases: { id: string }[];
  activePatient: { id: string; phone: string; fullName: string };
  messages: unknown[];
  tasks: unknown[];
  arrivals: { patientId: string; patientName: string }[];
  facilityMetrics: {
    totalCases: number;
    activeTasks: number;
    theatreCasesToday: number;
    pendingEmails: number;
  };
};

async function availablePort() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function request(route: string, options: { role?: string; method?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}${route}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.role ? { Cookie: cookies[options.role] } : {}),
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {})
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(45_000)
  });
}

async function expectStatus(response: Response, expected: number) {
  if (response.status !== expected) {
    assert.fail(`Expected HTTP ${expected}, received ${response.status}: ${await response.text()}`);
  }
}

async function dashboard(role: string, id?: string): Promise<Dashboard> {
  const response = await request(`/api/dashboard${id ? `?patientId=${id}` : ""}`, { role });
  await expectStatus(response, 200);
  return response.json() as Promise<Dashboard>;
}

async function login(role: string, email: string) {
  const response = await request("/api/auth/login", {
    method: "POST",
    body: { email, password: "Demo123!" }
  });
  await expectStatus(response, 200);
  const cookie = response.headers.get("set-cookie");
  assert(cookie);
  assert(cookie.includes("HttpOnly"));
  cookies[role] = cookie.split(";")[0];
}

async function stopServer() {
  if (!server?.pid || server.exitCode !== null) return;
  const child = server;
  const exited = once(child, "exit");
  // Stop Next and its worker processes, including when setup or an assertion fails.
  process.kill(-child.pid!, "SIGTERM");
  const forceStop = setTimeout(() => {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { /* Already exited. */ }
  }, 5_000);
  forceStop.unref();
  await exited;
  clearTimeout(forceStop);
}

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "ubuntu-care-test-"));
  const appDirectory = path.join(temporaryDirectory, "app");
  await mkdir(path.join(appDirectory, "prisma"), { recursive: true });
  // Copy only source/configuration: never copy .env, a user's database, or .next.
  for (const directory of ["app", "components", "lib", "public"]) {
    await cp(path.join(projectRoot, directory), path.join(appDirectory, directory), { recursive: true });
  }
  for (const filename of ["package.json", "tsconfig.json", "next-env.d.ts", "next.config.mjs", "prisma/schema.prisma", "prisma/seed.ts"]) {
    await cp(path.join(projectRoot, filename), path.join(appDirectory, filename));
  }
  await symlink(path.join(projectRoot, "node_modules"), path.join(appDirectory, "node_modules"), "dir");
  const databasePath = path.join(temporaryDirectory, "integration.db");
  await writeFile(databasePath, "");
  const databaseUrl = `file:${databasePath}`;
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1"
  };
  await run(process.execPath, [path.join(projectRoot, "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
    cwd: appDirectory, env: environment, timeout: 60_000
  });
  await run(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
    cwd: appDirectory, env: environment, timeout: 60_000
  });
  database = new PrismaClient({ datasourceUrl: databaseUrl });
  const patient = await database.patientProfile.findFirstOrThrow({ where: { email: "patient@ubuntucare.demo" } });
  const otherPatient = await database.patientProfile.findFirstOrThrow({ where: { email: "pieter@ubuntucare.demo" } });
  patientId = patient.id;
  otherPatientId = otherPatient.id;

  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const nextServer = spawn(process.execPath, [path.join(projectRoot, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: appDirectory, env: environment, stdio: ["ignore", "pipe", "pipe"], detached: true
  });
  server = nextServer;
  for (const output of [nextServer.stdout, nextServer.stderr]) {
    output?.on("data", (data: Buffer) => { serverLog = (serverLog + data.toString()).slice(-12_000); });
  }
  const deadline = Date.now() + 90_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (nextServer.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/session`, { signal: AbortSignal.timeout(5_000) });
      if (response.status === 401) { ready = true; break; }
    } catch { /* Compilation/startup is still in progress. */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert(ready, `Test server failed to start:\n${serverLog}`);
  await login("patient", "patient@ubuntucare.demo");
  await login("otherPatient", "pieter@ubuntucare.demo");
  await login("doctor", "doctor@ubuntucare.demo");
  await login("nurse", "nurse@ubuntucare.demo");
  await login("admin", "admin@ubuntucare.demo");
}, { timeout: 180_000 });

after(async () => {
  await stopServer();
  await database?.$disconnect();
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

test("patient APIs require authentication", async () => {
  for (const route of ["/api/session", "/api/dashboard", `/api/admissions/${patientId}/pdf`]) {
    await expectStatus(await request(route), 401);
  }
  for (const route of ["/api/appointments", "/api/arrivals", "/api/medications"]) {
    await expectStatus(await request(route, { method: "POST", body: {} }), 401);
  }
  await expectStatus(await request("/api/profile", { method: "PUT", body: {} }), 401);
});

test("patient dashboards include only their own case and arrivals, without staff feeds", async () => {
  for (const [role, ownId] of [["patient", patientId], ["otherPatient", otherPatientId]]) {
    const payload = await dashboard(role);
    assert.equal(payload.activePatient.id, ownId);
    assert.deepEqual(payload.cases.map((item) => item.id), [ownId]);
    assert(payload.arrivals.length > 0);
    assert(payload.arrivals.every((arrival) => arrival.patientId === ownId));
    assert.deepEqual(payload.messages, []);
    assert.deepEqual(payload.tasks, []);
    assert.equal(payload.facilityMetrics.totalCases, 1);
    assert.equal(payload.facilityMetrics.activeTasks, 0);
    assert.equal(payload.facilityMetrics.theatreCasesToday, await database.theatreCase.count({ where: { patientId: ownId } }));
    assert.equal(payload.facilityMetrics.pendingEmails, await database.emailLog.count({ where: { patientId: ownId, status: { in: ["Queued", "Draft"] } } }));
  }
});

test("foreign and nonexistent dashboard cases return the same 404 to patients", async () => {
  for (const [role, foreignId] of [["patient", otherPatientId], ["otherPatient", patientId]]) {
    const foreign = await request(`/api/dashboard?patientId=${foreignId}`, { role });
    const missing = await request("/api/dashboard?patientId=does-not-exist", { role });
    await expectStatus(foreign, 404);
    await expectStatus(missing, 404);
    assert.deepEqual(await foreign.json(), await missing.json());
  }
});

test("staff dashboards retain shared operational data and selectable patient cases", async () => {
  for (const role of ["doctor", "nurse", "admin"]) {
    const payload = await dashboard(role, otherPatientId);
    assert.equal(payload.activePatient.id, otherPatientId);
    assert.equal(payload.cases.length, 3);
    assert(payload.messages.length > 0);
    assert(payload.tasks.length > 0);
    assert.equal(payload.arrivals.length, await database.arrivalRecord.count());
    assert.equal(payload.facilityMetrics.totalCases, 3);
  }
});

test("patients can export their own PDF; foreign and missing PDFs both return 404", async () => {
  for (const [role, ownId, foreignId] of [["patient", patientId, otherPatientId], ["otherPatient", otherPatientId, patientId]]) {
    const own = await request(`/api/admissions/${ownId}/pdf`, { role });
    await expectStatus(own, 200);
    assert.match(own.headers.get("content-type") ?? "", /application\/pdf/);
    assert.equal(Buffer.from(await own.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
    const foreign = await request(`/api/admissions/${foreignId}/pdf`, { role });
    const missing = await request("/api/admissions/does-not-exist/pdf", { role });
    await expectStatus(foreign, 404);
    await expectStatus(missing, 404);
    assert.deepEqual(await foreign.json(), await missing.json());
  }
  await expectStatus(await request(`/api/admissions/${otherPatientId}/pdf`, { role: "admin" }), 200);
});

const appointment = { scheduledAt: "2027-01-05T10:30:00+02:00", department: "Admissions", type: "Demo review" };

test("patients cannot create another patient's appointment, and denied requests do not write", async () => {
  const beforeCount = await database.appointment.count();
  for (const [role, foreignId] of [["patient", otherPatientId], ["otherPatient", patientId]]) {
    const foreign = await request("/api/appointments", { role, method: "POST", body: { ...appointment, patientId: foreignId } });
    const missing = await request("/api/appointments", { role, method: "POST", body: { ...appointment, patientId: "does-not-exist" } });
    await expectStatus(foreign, 404);
    await expectStatus(missing, 404);
    assert.deepEqual(await foreign.json(), await missing.json());
  }
  assert.equal(await database.appointment.count(), beforeCount);
});

test("patients book their own appointments and administrators book either patient", async () => {
  for (const [role, id] of [["patient", patientId], ["otherPatient", otherPatientId], ["admin", patientId], ["admin", otherPatientId]]) {
    const beforeCount = await database.appointment.count({ where: { patientId: id } });
    await expectStatus(await request("/api/appointments", { role, method: "POST", body: { ...appointment, patientId: id } }), 200);
    assert.equal(await database.appointment.count({ where: { patientId: id } }), beforeCount + 1);
  }
});

test("self-service profile saves demographics while preserving staff-owned fields", async () => {
  const previous = await database.patientProfile.findUniqueOrThrow({ where: { id: patientId } });
  const foreign = await database.patientProfile.findUniqueOrThrow({ where: { id: otherPatientId } });
  await expectStatus(await request("/api/profile", {
    role: "patient", method: "PUT", body: {
      ...previous,
      id: otherPatientId,
      phone: "+27 82 555 9999",
      facilityFileNumber: "FORGED",
      bloodType: "FORGED",
      triagePriority: "FORGED",
      visitPathway: "FORGED",
      ward: "FORGED",
      bedNumber: "FORGED"
    }
  }), 200);
  const updated = await database.patientProfile.findUniqueOrThrow({ where: { id: patientId } });
  assert.equal(updated.phone, "+27 82 555 9999");
  for (const key of ["facilityFileNumber", "bloodType", "triagePriority", "visitPathway", "ward", "bedNumber"] as const) {
    assert.equal(updated[key], previous[key], `Patient must not change ${key}`);
  }
  assert.deepEqual(await database.patientProfile.findUniqueOrThrow({ where: { id: otherPatientId } }), foreign);
  await expectStatus(await request("/api/profile", { role: "admin", method: "PUT", body: { id: patientId, ward: "Demo ward" } }), 200);
  assert.equal((await database.patientProfile.findUniqueOrThrow({ where: { id: patientId } })).ward, "Demo ward");
});

test("medication administration rejects a different active patient without writing", async () => {
  const order = await database.medicationOrder.findFirstOrThrow({ where: { patientId } });
  const beforeCount = await database.medicationAdministration.count();
  const response = await request("/api/medications", {
    role: "nurse", method: "POST", body: { action: "administer", orderId: order.id, patientId: otherPatientId, status: "Given" }
  });
  await expectStatus(response, 400);
  assert.equal(await database.medicationAdministration.count(), beforeCount);
});

test("clinical staff chart medication for the matching patient; other roles cannot", async () => {
  const order = await database.medicationOrder.findFirstOrThrow({ where: { patientId } });
  const body = { action: "administer", orderId: order.id, patientId, status: "Given", notes: "Integration demo" };
  const beforeCount = await database.medicationAdministration.count({ where: { orderId: order.id } });
  for (const role of ["patient", "admin"]) {
    await expectStatus(await request("/api/medications", { role, method: "POST", body }), 403);
  }
  assert.equal(await database.medicationAdministration.count({ where: { orderId: order.id } }), beforeCount);
  for (const role of ["nurse", "doctor"]) {
    await expectStatus(await request("/api/medications", { role, method: "POST", body }), 200);
  }
  assert.equal(await database.medicationAdministration.count({ where: { orderId: order.id } }), beforeCount + 2);
});

test("medication administration requires patient context and an active medication order", async () => {
  const order = await database.medicationOrder.findFirstOrThrow({ where: { patientId } });
  const beforeCount = await database.medicationAdministration.count();
  const missingPatient = await request("/api/medications", {
    role: "nurse", method: "POST", body: { action: "administer", orderId: order.id, status: "Given" }
  });
  await expectStatus(missingPatient, 400);
  await database.medicationOrder.update({ where: { id: order.id }, data: { status: "Stopped" } });
  try {
    const stopped = await request("/api/medications", {
      role: "nurse", method: "POST", body: { action: "administer", orderId: order.id, patientId, status: "Given" }
    });
    await expectStatus(stopped, 409);
    assert.equal(await database.medicationAdministration.count(), beforeCount);
  } finally {
    await database.medicationOrder.update({ where: { id: order.id }, data: { status: order.status } });
  }
});

test("medication administration rejects missing orders and invalid statuses without writing", async () => {
  const order = await database.medicationOrder.findFirstOrThrow({ where: { patientId } });
  const beforeCount = await database.medicationAdministration.count();
  await expectStatus(await request("/api/medications", {
    role: "nurse", method: "POST", body: { action: "administer", orderId: "does-not-exist", patientId, status: "Given" }
  }), 404);
  await expectStatus(await request("/api/medications", {
    role: "nurse", method: "POST", body: { action: "administer", orderId: order.id, patientId, status: "FORGED" }
  }), 400);
  assert.equal(await database.medicationAdministration.count(), beforeCount);
});

test("only doctors prescribe validated medication orders for existing patients", async () => {
  const body = { action: "prescribe", patientId, drugName: "Synthetic demo medication", dose: "Demo dose", route: "Oral", frequency: "Demo frequency", startDate: "2026-11-15" };
  const beforeCount = await database.medicationOrder.count();
  for (const role of ["patient", "nurse", "admin"]) {
    await expectStatus(await request("/api/medications", { role, method: "POST", body }), 403);
  }
  for (const invalid of [{ ...body, dose: "" }, { ...body, route: "FORGED" }, { ...body, startDate: "not-a-date" }, { ...body, endDate: "2026-01-01" }]) {
    await expectStatus(await request("/api/medications", { role: "doctor", method: "POST", body: invalid }), 400);
  }
  await expectStatus(await request("/api/medications", { role: "doctor", method: "POST", body: { ...body, patientId: "does-not-exist" } }), 404);
  assert.equal(await database.medicationOrder.count(), beforeCount);
  await expectStatus(await request("/api/medications", { role: "doctor", method: "POST", body }), 200);
  const order = await database.medicationOrder.findFirstOrThrow({ where: { drugName: body.drugName } });
  assert.equal(order.patientId, patientId);
  assert.equal(order.prescribedByRole, "doctor");
  assert.equal(await database.medicationOrder.count(), beforeCount + 1);
});

test("arrival registration rejects missing or nonexistent patients without writing", async () => {
  const beforeCount = await database.arrivalRecord.count();
  await expectStatus(await request("/api/arrivals", { role: "admin", method: "POST", body: {} }), 400);
  await expectStatus(await request("/api/arrivals", { role: "admin", method: "POST", body: { patientId: "does-not-exist" } }), 404);
  assert.equal(await database.arrivalRecord.count(), beforeCount);
});

test("arrival names come from the selected patient, including when a name is blank or spoofed", async () => {
  const patient = await database.patientProfile.findUniqueOrThrow({ where: { id: patientId } });
  for (const [role, patientName] of [["admin", ""], ["nurse", "A different patient"]]) {
    const notes = `Canonical name test: ${role}`;
    await expectStatus(await request("/api/arrivals", {
      role, method: "POST", body: { patientId, patientName, arrivalMode: "Ambulance", handoverNotes: notes }
    }), 200);
    const arrival = await database.arrivalRecord.findFirstOrThrow({ where: { handoverNotes: notes } });
    assert.equal(arrival.patientId, patientId);
    assert.equal(arrival.patientName, patient.fullName);
  }
  await expectStatus(await request("/api/arrivals", { role: "patient", method: "POST", body: { patientId } }), 403);
});
