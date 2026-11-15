import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import type { JourneyPayload, JourneyClaim } from "../lib/care-types";
import type { PortalContext, PortalDocument, PortalThread } from "../lib/portal-types";

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
const portalUsers: Record<string, { id: string; name: string; email: string }> = {};

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
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

async function request(
  route: string,
  options: { role?: string; method?: string; body?: unknown } = {}
) {
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
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      /* Already exited. */
    }
  }, 5_000);
  forceStop.unref();
  await exited;
  clearTimeout(forceStop);
}

before(
  async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "ubuntu-care-test-"));
    const appDirectory = path.join(temporaryDirectory, "app");
    await mkdir(path.join(appDirectory, "prisma"), { recursive: true });
    // Copy only source/configuration: never copy .env, a user's database, or .next.
    for (const directory of ["app", "components", "lib", "public", "scripts"]) {
      await cp(path.join(projectRoot, directory), path.join(appDirectory, directory), {
        recursive: true
      });
    }
    for (const filename of [
      "package.json",
      "tsconfig.json",
      "next-env.d.ts",
      "next.config.mjs",
      "prisma/schema.prisma",
      "prisma/seed.ts"
    ]) {
      await cp(path.join(projectRoot, filename), path.join(appDirectory, filename));
    }
    await symlink(
      path.join(projectRoot, "node_modules"),
      path.join(appDirectory, "node_modules"),
      "dir"
    );
    const databasePath = path.join(temporaryDirectory, "integration.db");
    const databaseUrl = `file:${databasePath}`;
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1"
    };
    await run(process.execPath, ["scripts/prepare-sqlite.mjs"], {
      cwd: appDirectory,
      env: environment,
      timeout: 30_000
    });
    await run(
      process.execPath,
      [
        path.join(projectRoot, "node_modules/prisma/build/index.js"),
        "db",
        "push",
        "--skip-generate"
      ],
      {
        cwd: appDirectory,
        env: environment,
        timeout: 60_000
      }
    );
    await run(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
      cwd: appDirectory,
      env: environment,
      timeout: 60_000
    });
    const seededContents = await readFile(databasePath);
    await run(process.execPath, ["scripts/prepare-sqlite.mjs"], {
      cwd: appDirectory,
      env: environment,
      timeout: 30_000
    });
    assert.deepEqual(
      await readFile(databasePath),
      seededContents,
      "Preparing an existing SQLite file must preserve its data"
    );
    database = new PrismaClient({ datasourceUrl: databaseUrl });
    const patient = await database.patientProfile.findFirstOrThrow({
      where: { email: "patient@ubuntucare.demo" }
    });
    const otherPatient = await database.patientProfile.findFirstOrThrow({
      where: { email: "pieter@ubuntucare.demo" }
    });
    patientId = patient.id;
    otherPatientId = otherPatient.id;

    const port = await availablePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const nextServer = spawn(
      process.execPath,
      [
        path.join(projectRoot, "node_modules/next/dist/bin/next"),
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port)
      ],
      {
        cwd: appDirectory,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true
      }
    );
    server = nextServer;
    for (const output of [nextServer.stdout, nextServer.stderr]) {
      output?.on("data", (data: Buffer) => {
        serverLog = (serverLog + data.toString()).slice(-12_000);
      });
    }
    const deadline = Date.now() + 90_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (nextServer.exitCode !== null) break;
      try {
        const response = await fetch(`${baseUrl}/api/session`, {
          signal: AbortSignal.timeout(5_000)
        });
        if (response.status === 401) {
          ready = true;
          break;
        }
      } catch {
        /* Compilation/startup is still in progress. */
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert(ready, `Test server failed to start:\n${serverLog}`);
    await login("patient", "patient@ubuntucare.demo");
    await login("otherPatient", "pieter@ubuntucare.demo");
    await login("doctor", "doctor@ubuntucare.demo");
    await login("nurse", "nurse@ubuntucare.demo");
    await login("admin", "admin@ubuntucare.demo");
    for (const role of ["paramedic", "paramedic2", "billing", "insurer", "insurer2", "referring"]) {
      await login(role, `${role}@ubuntucare.demo`);
    }
    for (const user of await database.user.findMany({
      select: { id: true, name: true, email: true }
    })) {
      const role = user.email.split("@")[0];
      portalUsers[role === "pieter" ? "otherPatient" : role] = user;
    }
  },
  { timeout: 180_000 }
);

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
  for (const [role, ownId] of [
    ["patient", patientId],
    ["otherPatient", otherPatientId]
  ]) {
    const payload = await dashboard(role);
    assert.equal(payload.activePatient.id, ownId);
    assert.deepEqual(
      payload.cases.map((item) => item.id),
      [ownId]
    );
    assert(payload.arrivals.length > 0);
    assert(payload.arrivals.every((arrival) => arrival.patientId === ownId));
    assert.deepEqual(payload.messages, []);
    assert.deepEqual(payload.tasks, []);
    assert.equal(payload.facilityMetrics.totalCases, 1);
    assert.equal(payload.facilityMetrics.activeTasks, 0);
    assert.equal(
      payload.facilityMetrics.theatreCasesToday,
      await database.theatreCase.count({ where: { patientId: ownId } })
    );
    assert.equal(
      payload.facilityMetrics.pendingEmails,
      await database.emailLog.count({
        where: { patientId: ownId, status: { in: ["Queued", "Draft"] } }
      })
    );
  }
});

test("foreign and nonexistent dashboard cases return the same 404 to patients", async () => {
  for (const [role, foreignId] of [
    ["patient", otherPatientId],
    ["otherPatient", patientId]
  ]) {
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
  for (const [role, ownId, foreignId] of [
    ["patient", patientId, otherPatientId],
    ["otherPatient", otherPatientId, patientId]
  ]) {
    const own = await request(`/api/admissions/${ownId}/pdf`, { role });
    await expectStatus(own, 200);
    assert.match(own.headers.get("content-type") ?? "", /application\/pdf/);
    assert.equal(
      Buffer.from(await own.arrayBuffer())
        .subarray(0, 5)
        .toString(),
      "%PDF-"
    );
    const foreign = await request(`/api/admissions/${foreignId}/pdf`, { role });
    const missing = await request("/api/admissions/does-not-exist/pdf", { role });
    await expectStatus(foreign, 404);
    await expectStatus(missing, 404);
    assert.deepEqual(await foreign.json(), await missing.json());
  }
  await expectStatus(
    await request(`/api/admissions/${otherPatientId}/pdf`, { role: "admin" }),
    200
  );
});

const appointment = {
  scheduledAt: "2027-01-05T10:30:00+02:00",
  department: "Admissions",
  type: "Demo review"
};

test("patients cannot create another patient's appointment, and denied requests do not write", async () => {
  const beforeCount = await database.appointment.count();
  for (const [role, foreignId] of [
    ["patient", otherPatientId],
    ["otherPatient", patientId]
  ]) {
    const foreign = await request("/api/appointments", {
      role,
      method: "POST",
      body: { ...appointment, patientId: foreignId }
    });
    const missing = await request("/api/appointments", {
      role,
      method: "POST",
      body: { ...appointment, patientId: "does-not-exist" }
    });
    await expectStatus(foreign, 404);
    await expectStatus(missing, 404);
    assert.deepEqual(await foreign.json(), await missing.json());
  }
  assert.equal(await database.appointment.count(), beforeCount);
});

test("patients book their own appointments and administrators book either patient", async () => {
  for (const [role, id] of [
    ["patient", patientId],
    ["otherPatient", otherPatientId],
    ["admin", patientId],
    ["admin", otherPatientId]
  ]) {
    const beforeCount = await database.appointment.count({ where: { patientId: id } });
    await expectStatus(
      await request("/api/appointments", {
        role,
        method: "POST",
        body: { ...appointment, patientId: id }
      }),
      200
    );
    assert.equal(await database.appointment.count({ where: { patientId: id } }), beforeCount + 1);
  }
});

test("self-service profile saves demographics while preserving staff-owned fields", async () => {
  const previous = await database.patientProfile.findUniqueOrThrow({ where: { id: patientId } });
  const foreign = await database.patientProfile.findUniqueOrThrow({
    where: { id: otherPatientId }
  });
  await expectStatus(
    await request("/api/profile", {
      role: "patient",
      method: "PUT",
      body: {
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
    }),
    200
  );
  const updated = await database.patientProfile.findUniqueOrThrow({ where: { id: patientId } });
  assert.equal(updated.phone, "+27 82 555 9999");
  for (const key of [
    "facilityFileNumber",
    "bloodType",
    "triagePriority",
    "visitPathway",
    "ward",
    "bedNumber"
  ] as const) {
    assert.equal(updated[key], previous[key], `Patient must not change ${key}`);
  }
  assert.deepEqual(
    await database.patientProfile.findUniqueOrThrow({ where: { id: otherPatientId } }),
    foreign
  );
  await expectStatus(
    await request("/api/profile", {
      role: "admin",
      method: "PUT",
      body: { id: patientId, ward: "Demo ward" }
    }),
    200
  );
  assert.equal(
    (await database.patientProfile.findUniqueOrThrow({ where: { id: patientId } })).ward,
    "Demo ward"
  );
});

test("medication administration rejects a different active patient without writing", async () => {
  const order = await database.medicationOrder.findFirstOrThrow({ where: { patientId } });
  const beforeCount = await database.medicationAdministration.count();
  const response = await request("/api/medications", {
    role: "nurse",
    method: "POST",
    body: { action: "administer", orderId: order.id, patientId: otherPatientId, status: "Given" }
  });
  await expectStatus(response, 400);
  assert.equal(await database.medicationAdministration.count(), beforeCount);
});

test("clinical staff chart medication for the matching patient; other roles cannot", async () => {
  const order = await database.medicationOrder.findFirstOrThrow({ where: { patientId } });
  const body = {
    action: "administer",
    orderId: order.id,
    patientId,
    status: "Given",
    notes: "Integration demo"
  };
  const beforeCount = await database.medicationAdministration.count({
    where: { orderId: order.id }
  });
  for (const role of ["patient", "admin"]) {
    await expectStatus(await request("/api/medications", { role, method: "POST", body }), 403);
  }
  assert.equal(
    await database.medicationAdministration.count({ where: { orderId: order.id } }),
    beforeCount
  );
  for (const role of ["nurse", "doctor"]) {
    await expectStatus(await request("/api/medications", { role, method: "POST", body }), 200);
  }
  assert.equal(
    await database.medicationAdministration.count({ where: { orderId: order.id } }),
    beforeCount + 2
  );
});

test("medication administration requires patient context and an active medication order", async () => {
  const order = await database.medicationOrder.findFirstOrThrow({ where: { patientId } });
  const beforeCount = await database.medicationAdministration.count();
  const missingPatient = await request("/api/medications", {
    role: "nurse",
    method: "POST",
    body: { action: "administer", orderId: order.id, status: "Given" }
  });
  await expectStatus(missingPatient, 400);
  await database.medicationOrder.update({ where: { id: order.id }, data: { status: "Stopped" } });
  try {
    const stopped = await request("/api/medications", {
      role: "nurse",
      method: "POST",
      body: { action: "administer", orderId: order.id, patientId, status: "Given" }
    });
    await expectStatus(stopped, 409);
    assert.equal(await database.medicationAdministration.count(), beforeCount);
  } finally {
    await database.medicationOrder.update({
      where: { id: order.id },
      data: { status: order.status }
    });
  }
});

test("medication administration rejects missing orders and invalid statuses without writing", async () => {
  const order = await database.medicationOrder.findFirstOrThrow({ where: { patientId } });
  const beforeCount = await database.medicationAdministration.count();
  await expectStatus(
    await request("/api/medications", {
      role: "nurse",
      method: "POST",
      body: { action: "administer", orderId: "does-not-exist", patientId, status: "Given" }
    }),
    404
  );
  await expectStatus(
    await request("/api/medications", {
      role: "nurse",
      method: "POST",
      body: { action: "administer", orderId: order.id, patientId, status: "FORGED" }
    }),
    400
  );
  assert.equal(await database.medicationAdministration.count(), beforeCount);
});

test("only doctors prescribe validated medication orders for existing patients", async () => {
  const body = {
    action: "prescribe",
    patientId,
    drugName: "Synthetic demo medication",
    dose: "Demo dose",
    route: "Oral",
    frequency: "Demo frequency",
    startDate: "2026-11-15"
  };
  const beforeCount = await database.medicationOrder.count();
  for (const role of ["patient", "nurse", "admin"]) {
    await expectStatus(await request("/api/medications", { role, method: "POST", body }), 403);
  }
  for (const invalid of [
    { ...body, dose: "" },
    { ...body, route: "FORGED" },
    { ...body, startDate: "not-a-date" },
    { ...body, endDate: "2026-01-01" }
  ]) {
    await expectStatus(
      await request("/api/medications", { role: "doctor", method: "POST", body: invalid }),
      400
    );
  }
  await expectStatus(
    await request("/api/medications", {
      role: "doctor",
      method: "POST",
      body: { ...body, patientId: "does-not-exist" }
    }),
    404
  );
  assert.equal(await database.medicationOrder.count(), beforeCount);
  await expectStatus(
    await request("/api/medications", { role: "doctor", method: "POST", body }),
    200
  );
  const order = await database.medicationOrder.findFirstOrThrow({
    where: { drugName: body.drugName }
  });
  assert.equal(order.patientId, patientId);
  assert.equal(order.prescribedByRole, "doctor");
  assert.equal(await database.medicationOrder.count(), beforeCount + 1);
});

test("arrival registration rejects missing or nonexistent patients without writing", async () => {
  const beforeCount = await database.arrivalRecord.count();
  await expectStatus(
    await request("/api/arrivals", { role: "admin", method: "POST", body: {} }),
    400
  );
  await expectStatus(
    await request("/api/arrivals", {
      role: "admin",
      method: "POST",
      body: { patientId: "does-not-exist" }
    }),
    404
  );
  assert.equal(await database.arrivalRecord.count(), beforeCount);
});

test("arrival names come from the selected patient, including when a name is blank or spoofed", async () => {
  const patient = await database.patientProfile.findUniqueOrThrow({ where: { id: patientId } });
  for (const [role, patientName] of [
    ["admin", ""],
    ["nurse", "A different patient"]
  ]) {
    const notes = `Canonical name test: ${role}`;
    await expectStatus(
      await request("/api/arrivals", {
        role,
        method: "POST",
        body: { patientId, patientName, arrivalMode: "Ambulance", handoverNotes: notes }
      }),
      200
    );
    const arrival = await database.arrivalRecord.findFirstOrThrow({
      where: { handoverNotes: notes }
    });
    assert.equal(arrival.patientId, patientId);
    assert.equal(arrival.patientName, patient.fullName);
  }
  await expectStatus(
    await request("/api/arrivals", { role: "patient", method: "POST", body: { patientId } }),
    403
  );
});

let careId: string;
let careClaimId: string;
const internalMarker = "INTERNAL-CLINICAL-MARKER-PRIVATE";

async function journey(role: string, id = careId): Promise<JourneyPayload> {
  const response = await request(`/api/journey${id ? `?encounterId=${id}` : ""}`, { role });
  await expectStatus(response, 200);
  return response.json() as Promise<JourneyPayload>;
}
async function postCare(
  role: string,
  body: Record<string, unknown>,
  endpoint = "/api/journey",
  expected = 200
) {
  const response = await request(endpoint, {
    role,
    method: "POST",
    body: { encounterId: careId, ...body }
  });
  await expectStatus(response, expected);
  return response.json() as Promise<Record<string, unknown>>;
}
async function nextStage(role: string, status: string, extra: Record<string, unknown> = {}) {
  const current = await journey(role);
  return postCare(role, {
    action: "transition",
    status,
    version: current.activeEncounter!.version,
    ...extra
  });
}
async function currentClaim(role = "billing"): Promise<JourneyClaim> {
  const current = await journey(role);
  const claim = current.claims.find((item) => item.id === careClaimId);
  assert(claim, "Expected claim in authorized workspace");
  return claim;
}
async function claimCommand(role: string, body: Record<string, unknown>, expected = 200) {
  const claim = await currentClaim(role);
  return postCare(
    role,
    { claimId: careClaimId, version: claim.version, ...body },
    "/api/claims",
    expected
  );
}

test("new ambulance, billing and insurer roles cannot use legacy clinical APIs", async () => {
  for (const role of ["paramedic", "billing", "insurer"]) {
    await expectStatus(await request("/api/dashboard", { role }), 403);
    await expectStatus(await request(`/api/admissions/${patientId}/pdf`, { role }), 403);
    for (const endpoint of [
      "appointments",
      "arrivals",
      "medications",
      "labs",
      "scans",
      "tasks",
      "messages",
      "documents",
      "emails",
      "transfers",
      "theatre",
      "vitals"
    ]) {
      await expectStatus(
        await request(`/api/${endpoint}`, { role, method: "POST", body: {} }),
        403
      );
    }
    await expectStatus(await request("/api/profile", { role, method: "PUT", body: {} }), 403);
  }
});

test("encounter creation and crew assignment enforce patient and staff boundaries", async () => {
  const crew = await database.user.findUniqueOrThrow({
    where: { email: "paramedic@ubuntucare.demo" }
  });
  const body = {
    action: "createEncounter",
    patientId,
    crewUserId: crew.id,
    chiefComplaint: "Fictional end-to-end presentation",
    location: "Demo pickup point",
    triage: "Yellow"
  };
  await postCare("patient", body, "/api/journey", 403);
  await postCare("admin", { ...body, patientId: "missing" }, "/api/journey", 404);
  const response = await postCare("admin", body);
  const encounter = response.encounter as { id: string; status: string };
  careId = encounter.id;
  assert.equal(encounter.status, "REQUESTED");
  for (const role of ["otherPatient", "paramedic2", "insurer"])
    await expectStatus(await request(`/api/journey?encounterId=${careId}`, { role }), 404);
  assert.equal((await journey("paramedic")).activeEncounter!.id, careId);
  assert.equal((await journey("patient")).activeEncounter!.patient.id, patientId);
});

test("simulated calls persist without granting ambulance access to billing or other cases", async () => {
  const response = await postCare(
    "paramedic",
    {
      action: "simulateCall",
      purpose: "EMS",
      direction: "INBOUND",
      contactName: "Fictional caller",
      phone: "+27 10 555 0100",
      summary: "No actual call"
    },
    "/api/integrations"
  );
  assert.equal(response.simulated, true);
  assert.equal((response.call as { status: string }).status, "SIMULATED_COMPLETED");
  await postCare(
    "paramedic",
    {
      action: "simulateCall",
      purpose: "MEDICAL_AID",
      direction: "OUTBOUND",
      contactName: "Demo",
      phone: "000",
      summary: "Not permitted"
    },
    "/api/integrations",
    403
  );
  await postCare(
    "billing",
    {
      action: "simulateCall",
      purpose: "EMS",
      direction: "OUTBOUND",
      contactName: "Demo",
      phone: "000",
      summary: "Not permitted"
    },
    "/api/integrations",
    403
  );
  assert.equal((await journey("billing")).calls.length, 0);
});

test("dispatch-to-handover state transitions reject skips, stale writes and missing handovers", async () => {
  const count = await database.careAuditEvent.count({ where: { encounterId: careId } });
  await postCare(
    "admin",
    { action: "transition", status: "ADMITTED", version: 0 },
    "/api/journey",
    409
  );
  await postCare(
    "admin",
    { action: "transition", status: "DISPATCHED", version: 99 },
    "/api/journey",
    409
  );
  await postCare(
    "patient",
    { action: "transition", status: "DISPATCHED", version: 0 },
    "/api/journey",
    403
  );
  assert.equal(await database.careAuditEvent.count({ where: { encounterId: careId } }), count);
  await nextStage("admin", "DISPATCHED");
  await nextStage("paramedic", "ON_SCENE");
  await nextStage("paramedic", "IN_TRANSIT");
  const current = (await journey("paramedic")).activeEncounter!;
  await postCare(
    "paramedic",
    { action: "transition", status: "HANDED_OVER", version: current.version },
    "/api/journey",
    409
  );
  await postCare("paramedic", {
    action: "addNote",
    category: "Handover",
    body: "Fictional ambulance assessment and hospital handover"
  });
  await nextStage("paramedic", "HANDED_OVER");
  await nextStage("admin", "ADMITTED", { ward: "Demo ward", bed: "D-01" });
  await nextStage("nurse", "IN_CARE");
  assert.equal((await journey("doctor")).activeEncounter!.status, "IN_CARE");
  await postCare(
    "paramedic",
    { action: "addNote", category: "Handover", body: "Late amendment not supported" },
    "/api/journey",
    403
  );
});

test("clinical notes and unreleased laboratory results stay out of patient and finance responses", async () => {
  await postCare("nurse", {
    action: "recordVitals",
    systolic: 124,
    diastolic: 82,
    pulse: 75,
    temperature: 36.8,
    spo2: 98,
    respiratoryRate: 18,
    painScore: 1
  });
  await postCare("doctor", {
    action: "prescribeMedication",
    drugName: "DEMO encounter medication",
    dose: "Fictional dose",
    frequency: "Demo frequency",
    route: "Oral"
  });
  const prescribed = await database.medicationOrder.findFirstOrThrow({
    where: { drugName: "DEMO encounter medication" }
  });
  assert.equal(prescribed.patientId, patientId);
  await postCare("nurse", {
    action: "administerMedication",
    orderId: prescribed.id,
    status: "Withheld",
    notes: "Fictional observation"
  });
  const foreign = await database.medicationOrder.findFirstOrThrow({
    where: { patientId: otherPatientId }
  });
  await postCare(
    "nurse",
    { action: "administerMedication", orderId: foreign.id, status: "Given" },
    "/api/journey",
    400
  );
  await postCare("patient", { action: "recordVitals", systolic: 120 }, "/api/journey", 403);
  await postCare("doctor", { action: "addNote", category: "Clinical", body: internalMarker });
  await postCare("doctor", {
    action: "addNote",
    category: "Patient update",
    body: "Your fictional care team has reviewed the plan."
  });
  const result = await postCare("doctor", {
    action: "orderLab",
    testName: "DEMO FBC",
    specimen: "Blood"
  });
  const lab = result.labOrder as { id: string };
  await postCare("nurse", { action: "collectLab", labOrderId: lab.id });
  await postCare("nurse", {
    action: "resultLab",
    labOrderId: lab.id,
    resultSummary: "Fictional laboratory result",
    abnormalFlag: "Normal"
  });
  assert.equal((await journey("patient")).labOrders.length, 0);
  assert(!JSON.stringify(await journey("patient")).includes(internalMarker));
  for (const role of ["billing", "paramedic"]) {
    const payload = await journey(role);
    assert.equal(payload.labOrders.length, 0);
    assert(!JSON.stringify(payload).includes(internalMarker));
  }
  const current = (await journey("doctor")).activeEncounter!;
  await postCare(
    "doctor",
    {
      action: "transition",
      status: "READY_FOR_DISCHARGE",
      version: current.version,
      diagnosisCode: "R51",
      clinicalSummary: "Demo clinical assessment",
      dischargeSummary: "Demo follow-up instructions"
    },
    "/api/journey",
    409
  );
  await postCare("doctor", { action: "reviewLab", labOrderId: lab.id });
  const released = await journey("patient");
  assert.equal(released.labOrders.length, 1);
  assert.equal(released.labOrders[0].status, "REVIEWED");
});

test("clinical discharge completes independently of medical-aid eligibility or sharing consent", async () => {
  await postCare("patient", {
    action: "recordConsent",
    popiaConsent: true,
    consentDataSharing: false,
    consentTreatment: true
  });
  await nextStage("doctor", "READY_FOR_DISCHARGE", {
    diagnosisCode: "R51",
    clinicalSummary: "Fictional episode summary",
    dischargeSummary: "Fictional discharge instructions and follow-up"
  });
  await nextStage("nurse", "DISCHARGED");
  const patient = await journey("patient");
  assert.equal(patient.activeEncounter!.status, "DISCHARGED");
  assert(patient.activeEncounter!.dischargeSummary);
  await postCare(
    "doctor",
    { action: "addNote", category: "Clinical", body: "Closed record" },
    "/api/journey",
    409
  );
  await postCare("nurse", { action: "recordVitals" }, "/api/journey", 409);
  await postCare(
    "billing",
    { action: "checkEligibility", consentConfirmed: true, purpose: "Demo claim" },
    "/api/integrations",
    409
  );
  await postCare("patient", {
    action: "recordConsent",
    popiaConsent: true,
    consentDataSharing: true,
    consentTreatment: true
  });
});

test("identity and benefits simulations enforce consent, purpose and provider failure handling", async () => {
  await postCare(
    "admin",
    { action: "verifyIdentity", consentConfirmed: false, purpose: "Admission" },
    "/api/integrations",
    409
  );
  const result = await postCare(
    "admin",
    { action: "verifyIdentity", consentConfirmed: true, purpose: "Fictional admission" },
    "/api/integrations"
  );
  assert.equal(result.simulated, true);
  assert.equal((result.identityCheck as { status: string }).status, "MATCH");
  const profile = await database.patientProfile.findUniqueOrThrow({ where: { id: patientId } });
  assert(!JSON.stringify(result).includes(profile.saId));
  await postCare(
    "billing",
    { action: "verifyIdentity", consentConfirmed: true, purpose: "Claims" },
    "/api/integrations",
    403
  );
  const unavailable = await postCare(
    "billing",
    {
      action: "checkEligibility",
      consentConfirmed: true,
      purpose: "Benefits",
      scenario: "unavailable"
    },
    "/api/integrations"
  );
  assert.equal((unavailable.eligibilityCheck as { status: string }).status, "UNAVAILABLE");
  await postCare(
    "billing",
    { action: "requestAuthorization", consentConfirmed: true, purpose: "Treatment" },
    "/api/integrations",
    409
  );
});

test("claim fees use integer cents and validation reports missing funding without submitting", async () => {
  const result = await postCare("billing", { action: "create" }, "/api/claims");
  careClaimId = (result.claim as { id: string }).id;
  const before = await database.careClaimLine.count();
  for (const values of [
    { quantity: 1, unitPriceCents: -1 },
    { quantity: 0, unitPriceCents: 100 },
    { quantity: 1, unitPriceCents: 1.5 }
  ]) {
    await claimCommand(
      "billing",
      { action: "addLine", serviceCode: "DEMO", description: "Fictional fee", ...values },
      400
    );
  }
  assert.equal(await database.careClaimLine.count(), before);
  await claimCommand("billing", {
    action: "addLine",
    serviceCode: "DEMO-CONSULT",
    description: "Fictional consultations",
    quantity: 2,
    unitPriceCents: 12550,
    totalCents: 1
  });
  await claimCommand("billing", {
    action: "addLine",
    serviceCode: "DEMO-BED",
    description: "Fictional ward fee",
    quantity: 1,
    unitPriceCents: 72000
  });
  assert.equal((await currentClaim()).totalCents, 97100);
  const invalid = await claimCommand("billing", { action: "validate" });
  assert.equal(invalid.valid, false);
  assert((invalid.errors as string[]).length > 0);
  assert.equal((await currentClaim()).status, "DRAFT");
});

test("authorised claim submission is versioned, minimal and cannot be duplicated", async () => {
  await postCare(
    "billing",
    { action: "checkEligibility", consentConfirmed: true, purpose: "Fictional hospital claim" },
    "/api/integrations"
  );
  await postCare(
    "billing",
    { action: "requestAuthorization", consentConfirmed: true, purpose: "Fictional hospital claim" },
    "/api/integrations"
  );
  const valid = await claimCommand("billing", { action: "validate" });
  assert.equal(valid.valid, true);
  await claimCommand(
    "billing",
    {
      action: "addLine",
      serviceCode: "DEMO",
      description: "Cannot alter validated invoice",
      quantity: 1,
      unitPriceCents: 100
    },
    409
  );
  await claimCommand("billing", { action: "submit" });
  assert.equal((await currentClaim()).status, "SUBMITTED");
  await claimCommand("billing", { action: "submit" }, 409);
  const insurer = await journey("insurer");
  assert.equal(insurer.claims.length, 1);
  assert.equal(insurer.notes.length, 0);
  assert.equal(insurer.labOrders.length, 0);
  assert.equal(insurer.vitals.length, 0);
  assert.equal(insurer.calls.length, 0);
  const profile = await database.patientProfile.findUniqueOrThrow({ where: { id: patientId } });
  for (const secret of [
    profile.saId,
    profile.medicalAidNumber,
    internalMarker,
    "Fictional laboratory result",
    "Fictional episode summary"
  ])
    assert(!JSON.stringify(insurer).includes(secret));
  const exported = await request(`/api/claims/${careClaimId}/export`, { role: "insurer" });
  await expectStatus(exported, 200);
  const packet = await exported.json();
  assert.equal(packet.simulated, true);
  assert.equal(packet.packet.totalCents, 97100);
  assert.equal(packet.packet.patient.saId, undefined);
  await expectStatus(await request(`/api/claims/${careClaimId}/export`, { role: "insurer2" }), 404);
  await expectStatus(await request(`/api/claims/${careClaimId}/export`, { role: "patient" }), 403);
});

test("medical-aid consent revocation blocks future packet access and review", async () => {
  await postCare("patient", {
    action: "recordConsent",
    popiaConsent: true,
    consentDataSharing: false,
    consentTreatment: true
  });
  await expectStatus(await request(`/api/journey?encounterId=${careId}`, { role: "insurer" }), 404);
  await expectStatus(await request(`/api/claims/${careClaimId}/export`, { role: "insurer" }), 404);
  await postCare(
    "insurer",
    {
      action: "review",
      claimId: careClaimId,
      version: (await currentClaim()).version,
      decision: "APPROVED"
    },
    "/api/claims",
    404
  );
  await postCare("patient", {
    action: "recordConsent",
    popiaConsent: true,
    consentDataSharing: true,
    consentTreatment: true
  });
});

test("returned claims can be corrected and resubmitted before approval and simulated payment", async () => {
  await claimCommand("insurer", {
    action: "review",
    decision: "NEEDS_INFORMATION",
    note: "Clarify a fictional service fee"
  });
  const previous = await currentClaim("insurer");
  await claimCommand("billing", {
    action: "addLine",
    serviceCode: "DEMO-LAB",
    description: "Fictional test fee",
    quantity: 1,
    unitPriceCents: 100
  });
  assert.equal(
    (await currentClaim("insurer")).totalCents,
    previous.totalCents,
    "Insurer sees the previously submitted packet until resubmission"
  );
  await claimCommand("billing", { action: "validate" });
  await claimCommand("billing", { action: "submit" });
  await claimCommand("insurer", { action: "review", decision: "APPROVED" });
  await claimCommand("billing", { action: "pay" });
  assert.equal((await currentClaim()).status, "PAID");
  assert.equal((await currentClaim()).totalCents, 97200);
  await claimCommand("billing", { action: "pay" }, 409);
  const events = await database.careAuditEvent.findMany({ where: { encounterId: careId } });
  assert(events.some((event) => event.action === "CLAIM_PAID_SIMULATED"));
  assert(events.some((event) => event.action === "STATUS_DISCHARGED"));
});

test("new patient registration creates a restricted account and accepts explicit consent choices", async () => {
  const result = await postCare("admin", {
    action: "registerPatient",
    fullName: "Synthetic New Patient",
    dateOfBirth: "1999-04-10",
    passportNumber: "DEMO-PASSPORT",
    email: "new.patient@ubuntucare.demo",
    phone: "+27 10 555 0199",
    medicalAidScheme: "Self-pay / cash patient",
    medicalAidNumber: "",
    popiaConsent: false,
    consentTreatment: false,
    consentDataSharing: false
  });
  const patient = result.patient as { id: string };
  const stored = await database.patientProfile.findUniqueOrThrow({
    where: { id: patient.id },
    include: { user: true }
  });
  assert.equal(stored.consentDataSharing, false);
  assert.equal(stored.user.role, "patient");
  const loginResponse = await request("/api/auth/login", {
    method: "POST",
    body: { email: stored.email, password: "Demo123!" }
  });
  await expectStatus(loginResponse, 401);
  assert(await database.careAuditEvent.findFirst({ where: { action: "PATIENT_REGISTERED" } }));
});

async function portalContext(role: string, encounterId = careId): Promise<PortalContext> {
  const response = await request(`/api/portal?encounterId=${encounterId}`, { role });
  await expectStatus(response, 200);
  return response.json() as Promise<PortalContext>;
}

async function portalCommand<T = Record<string, unknown>>(
  role: string,
  action: string,
  body: Record<string, unknown> = {},
  endpoint = "/api/portal/actions",
  expected = 200
): Promise<T> {
  const response = await request(endpoint, {
    role,
    method: "POST",
    body: { action, encounterId: careId, ...body }
  });
  await expectStatus(response, expected);
  return response.json() as Promise<T>;
}

async function documentList(role: string): Promise<PortalDocument[]> {
  const response = await request(`/api/portal/documents?encounterId=${careId}`, { role });
  await expectStatus(response, 200);
  return ((await response.json()) as { documents: PortalDocument[] }).documents;
}

async function threadList(role: string): Promise<PortalThread[]> {
  const response = await request(`/api/portal/messages?encounterId=${careId}`, { role });
  await expectStatus(response, 200);
  return ((await response.json()) as { threads: PortalThread[] }).threads;
}

async function threadDetail(role: string, threadId: string) {
  const response = await request(`/api/portal/messages?threadId=${threadId}`, { role });
  await expectStatus(response, 200);
  return ((await response.json()) as { thread: PortalThread }).thread;
}

function expectedDocumentHash(version: PortalDocument["latestVersion"]) {
  const files = version.files
    .map(({ originalName, mimeType, size, sha256 }) => ({ originalName, mimeType, size, sha256 }))
    .sort(
      (a, b) =>
        a.sha256.localeCompare(b.sha256) ||
        a.originalName.localeCompare(b.originalName) ||
        a.mimeType.localeCompare(b.mimeType) ||
        a.size - b.size
    );
  return createHash("sha256")
    .update(
      JSON.stringify({
        documentId: version.documentId,
        version: version.version,
        title: version.title,
        body: version.body,
        files
      }),
      "utf8"
    )
    .digest("hex");
}

async function uploadPortalFile(
  role: string,
  versionId: string,
  contents: string | Uint8Array,
  filename = "demo-notes.txt",
  mimeType = "text/plain",
  expected = 200
) {
  const form = new FormData();
  form.append("versionId", versionId);
  // Copy to an ArrayBuffer so this works with both Node and browser Blob typings.
  const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
  form.append("file", new Blob([Uint8Array.from(bytes).buffer], { type: mimeType }), filename);
  const response = await fetch(`${baseUrl}/api/portal/files`, {
    method: "POST",
    headers: { Cookie: cookies[role] },
    body: form,
    signal: AbortSignal.timeout(45_000)
  });
  await expectStatus(response, expected);
  return response.json() as Promise<{
    file: { id: string; originalName: string; mimeType: string; sha256: string };
  }>;
}

type TestAppointment = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  mode: string;
  version: number;
};
let portalAppointment: TestAppointment;
let videoRoomId: string;
let publishedDocumentId: string;
let publishedVersionId: string;
let publishedFileId: string;
let internalFileId: string;
let secureCareThreadId: string;
let claimThreadId: string;

function futureSlot(days: number, durationMinutes = 30) {
  const start = new Date(Date.now() + days * 86_400_000);
  start.setUTCHours(10, 0, 0, 0);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + durationMinutes * 60_000).toISOString()
  };
}

test("paperless routes authenticate requests and keep scoped context private", async () => {
  for (const route of [
    "/api/portal",
    `/api/portal/messages?encounterId=${careId}`,
    `/api/portal/documents?encounterId=${careId}`,
    `/api/portal/appointments?encounterId=${careId}`,
    "/api/portal/video?roomId=missing",
    "/api/portal/files/missing"
  ])
    await expectStatus(await request(route), 401);
  for (const endpoint of ["actions", "messages", "documents", "appointments", "video"]) {
    await expectStatus(await request(`/api/portal/${endpoint}`, { method: "POST", body: {} }), 401);
  }
  for (const role of ["patient", "doctor", "billing", "insurer"]) {
    const response = await request(`/api/portal?encounterId=${careId}`, { role });
    await expectStatus(response, 200);
    assert.match(response.headers.get("cache-control") ?? "", /private/);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.match(response.headers.get("vary") ?? "", /cookie/i);
    const context = (await response.json()) as PortalContext;
    assert.equal(context.activeEncounter?.id, careId);
    assert(!JSON.stringify(context).includes(internalMarker));
    if (["billing", "insurer"].includes(role)) {
      assert.equal(context.concerns.length, 0);
      assert.equal(context.tasks.length, 0);
    }
  }
  await expectStatus(
    await request(`/api/portal?encounterId=${careId}`, { role: "otherPatient" }),
    404
  );
  await expectStatus(
    await request(`/api/portal?encounterId=${careId}`, { role: "referring" }),
    404
  );
  await expectStatus(await request("/api/dashboard", { role: "referring" }), 403);
});

test("appointments require explicit timezone, future bounded slots, local clinicians and scope", async () => {
  const slot = futureSlot(10);
  const body = {
    clinicianId: portalUsers.doctor.id,
    title: "Fictional video follow-up",
    department: "Outpatients",
    mode: "VIDEO",
    patientInstructions: "PRIVATE-APPOINTMENT-INSTRUCTIONS",
    ...slot
  };
  for (const invalid of [
    { startsAt: slot.startsAt.slice(0, -1), endsAt: slot.endsAt.slice(0, -1) },
    { startsAt: "2026-02-31T10:00:00+02:00" },
    { startsAt: new Date(Date.now() - 60_000).toISOString() },
    { endsAt: slot.startsAt },
    { endsAt: new Date(Date.parse(slot.startsAt) + 5 * 3_600_000).toISOString() },
    { clinicianId: portalUsers.insurer.id },
    { mode: "EXTERNAL_LINK" }
  ])
    await portalCommand(
      "patient",
      "create",
      { ...body, ...invalid },
      "/api/portal/appointments",
      400
    );
  for (const role of ["billing", "insurer", "referring", "paramedic"]) {
    await portalCommand(role, "create", body, "/api/portal/appointments", 403);
    await expectStatus(
      await request(`/api/portal/appointments?encounterId=${careId}`, { role }),
      403
    );
  }
  await portalCommand("otherPatient", "create", body, "/api/portal/appointments", 404);
  const created = await portalCommand<{ appointment: TestAppointment }>(
    "patient",
    "create",
    body,
    "/api/portal/appointments"
  );
  portalAppointment = created.appointment;
  assert.equal(portalAppointment.status, "REQUESTED");
  assert.equal(portalAppointment.version, 0);
  const offset = futureSlot(12);
  const localStart = offset.startsAt.replace("T10:", "T12:").replace("Z", "+02:00");
  const localEnd = offset.endsAt.replace("T10:", "T12:").replace("Z", "+02:00");
  const converted = await portalCommand<{ appointment: TestAppointment }>(
    "doctor",
    "create",
    {
      ...body,
      startsAt: localStart,
      endsAt: localEnd,
      mode: "ONSITE"
    },
    "/api/portal/appointments"
  );
  assert.equal(converted.appointment.startsAt, offset.startsAt);
  assert.equal(converted.appointment.status, "CONFIRMED");
});

test("appointment confirmation checks overlaps and versions and exports a minimal UTF-8 calendar", async () => {
  await portalCommand(
    "patient",
    "confirm",
    { appointmentId: portalAppointment.id, version: 0 },
    "/api/portal/appointments",
    403
  );
  await portalCommand(
    "admin",
    "confirm",
    { appointmentId: portalAppointment.id, version: 12 },
    "/api/portal/appointments",
    409
  );
  const confirmed = await portalCommand<{ appointment: TestAppointment }>(
    "admin",
    "confirm",
    {
      appointmentId: portalAppointment.id,
      version: 0
    },
    "/api/portal/appointments"
  );
  portalAppointment = confirmed.appointment;
  assert.equal(portalAppointment.status, "CONFIRMED");
  assert.equal(portalAppointment.version, 1);
  await portalCommand(
    "admin",
    "confirm",
    { appointmentId: portalAppointment.id, version: 0 },
    "/api/portal/appointments",
    409
  );
  await portalCommand(
    "doctor",
    "create",
    {
      clinicianId: portalUsers.doctor.id,
      title: "Overlapping appointment",
      department: "Outpatients",
      startsAt: portalAppointment.startsAt,
      endsAt: portalAppointment.endsAt,
      mode: "VIDEO"
    },
    "/api/portal/appointments",
    409
  );
  const overlapRequest = await portalCommand<{ appointment: TestAppointment }>(
    "patient",
    "create",
    {
      clinicianId: portalUsers.doctor.id,
      title: "Requested overlapping visit",
      department: "General Medicine",
      mode: "ONSITE",
      startsAt: portalAppointment.startsAt,
      endsAt: portalAppointment.endsAt
    },
    "/api/portal/appointments"
  );
  await portalCommand(
    "admin",
    "confirm",
    { appointmentId: overlapRequest.appointment.id, version: 0 },
    "/api/portal/appointments",
    409
  );
  await portalCommand(
    "patient",
    "cancel",
    { appointmentId: overlapRequest.appointment.id, version: 0 },
    "/api/portal/appointments"
  );
  const response = await request(`/api/portal/appointments/${portalAppointment.id}/calendar`, {
    role: "patient"
  });
  await expectStatus(response, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/calendar.*utf-8/i);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const calendar = await response.text();
  assert.match(calendar, /BEGIN:VCALENDAR\r\n/);
  assert(
    calendar.includes(
      `DTSTART:${portalAppointment.startsAt.replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`
    )
  );
  assert(calendar.includes("SUMMARY:Hospital appointment"));
  for (const secret of [
    "PRIVATE-APPOINTMENT-INSTRUCTIONS",
    internalMarker,
    "Fictional video follow-up"
  ]) {
    assert(!calendar.includes(secret));
  }
  await expectStatus(
    await request(`/api/portal/appointments/${portalAppointment.id}/calendar`, {
      role: "otherPatient"
    }),
    404
  );
  await expectStatus(
    await request(`/api/portal/appointments/${portalAppointment.id}/calendar`, { role: "insurer" }),
    403
  );
});

test("appointment reminders are durable, simulated and idempotent and cancellation stops pending delivery", async () => {
  const reminders = await database.portalReminder.findMany({
    where: { appointmentId: portalAppointment.id }
  });
  assert.equal(
    reminders.length,
    8,
    "24-hour and 1-hour in-app/email reminders for both participants"
  );
  assert.equal(new Set(reminders.map((reminder) => reminder.dedupeKey)).size, 8);
  assert.deepEqual(
    new Set(reminders.map((reminder) => reminder.userId)),
    new Set([portalUsers.patient.id, portalUsers.doctor.id])
  );
  await database.portalReminder.updateMany({
    where: { appointmentId: portalAppointment.id },
    data: { dueAt: new Date(Date.now() - 1000) }
  });
  await portalCommand("doctor", "runReminders", {}, "/api/portal/appointments", 403);
  const processed = await portalCommand<{ processed: number; emailDelivery: string }>(
    "admin",
    "runReminders",
    {},
    "/api/portal/appointments"
  );
  assert(processed.processed >= 8);
  assert.equal(processed.emailDelivery, "SIMULATED_ONLY");
  const dedupeKeys = reminders.map((reminder) => `reminder:${reminder.id}`);
  const notifications = await database.portalNotification.findMany({
    where: { dedupeKey: { in: dedupeKeys } }
  });
  const emails = await database.portalOutbox.findMany({ where: { dedupeKey: { in: dedupeKeys } } });
  assert.equal(notifications.length, 4);
  assert.equal(emails.length, 4);
  assert(
    emails.every(
      (email) =>
        email.status === "QUEUED_SIMULATED" &&
        !email.body.includes("PRIVATE-APPOINTMENT-INSTRUCTIONS")
    )
  );
  assert.equal(
    await database.portalReminder.count({
      where: { appointmentId: portalAppointment.id, status: "DELIVERED" }
    }),
    8
  );
  const second = await portalCommand<{ processed: number }>(
    "admin",
    "runReminders",
    {},
    "/api/portal/appointments"
  );
  assert.equal(second.processed, 0);
  assert.equal(
    await database.portalNotification.count({ where: { dedupeKey: { in: dedupeKeys } } }),
    4
  );
  assert.equal(await database.portalOutbox.count({ where: { dedupeKey: { in: dedupeKeys } } }), 4);
  const extra = await portalCommand<{ appointment: TestAppointment }>(
    "doctor",
    "create",
    {
      clinicianId: portalUsers.nurse.id,
      title: "Cancelled fictional visit",
      department: "Outpatients",
      mode: "ONSITE",
      ...futureSlot(15)
    },
    "/api/portal/appointments"
  );
  await portalCommand(
    "otherPatient",
    "cancel",
    { appointmentId: extra.appointment.id, version: 0 },
    "/api/portal/appointments",
    404
  );
  await portalCommand(
    "patient",
    "cancel",
    { appointmentId: extra.appointment.id, version: 99 },
    "/api/portal/appointments",
    409
  );
  const cancelled = await portalCommand<{ appointment: TestAppointment }>(
    "patient",
    "cancel",
    {
      appointmentId: extra.appointment.id,
      version: 0
    },
    "/api/portal/appointments"
  );
  assert.equal(cancelled.appointment.status, "CANCELLED");
  assert.equal(
    await database.portalReminder.count({
      where: { appointmentId: extra.appointment.id, status: "CANCELLED" }
    }),
    8
  );
  await portalCommand(
    "patient",
    "cancel",
    { appointmentId: extra.appointment.id, version: 1 },
    "/api/portal/appointments",
    409
  );
});

test("video joins require the appointment participants and explicit, live privacy and treatment consent", async () => {
  const body = { appointmentId: portalAppointment.id, consentConfirmed: true };
  const onsite = await database.portalAppointment.findFirstOrThrow({
    where: { encounterId: careId, mode: "ONSITE", status: "CONFIRMED" }
  });
  await portalCommand(
    "patient",
    "join",
    { appointmentId: onsite.id, consentConfirmed: true },
    "/api/portal/video",
    409
  );
  for (const role of ["admin", "nurse", "otherPatient", "billing", "insurer", "referring"]) {
    await portalCommand(role, "join", body, "/api/portal/video", 404);
  }
  await portalCommand(
    "patient",
    "join",
    { ...body, consentConfirmed: false },
    "/api/portal/video",
    400
  );
  await postCare("patient", {
    action: "recordConsent",
    popiaConsent: false,
    consentTreatment: true,
    consentDataSharing: true
  });
  await portalCommand("patient", "join", body, "/api/portal/video", 403);
  await postCare("patient", {
    action: "recordConsent",
    popiaConsent: true,
    consentTreatment: false,
    consentDataSharing: true
  });
  await portalCommand("doctor", "join", body, "/api/portal/video", 403);
  await postCare("patient", {
    action: "recordConsent",
    popiaConsent: true,
    consentTreatment: true,
    consentDataSharing: true
  });
  const joined = await portalCommand<{ room: { id: string; status: string }; isOfferer: boolean }>(
    "patient",
    "join",
    body,
    "/api/portal/video"
  );
  videoRoomId = joined.room.id;
  assert.equal(joined.room.status, "WAITING");
  assert.equal(joined.isOfferer, false);
  await expectStatus(
    await request(`/api/portal/video?roomId=${videoRoomId}`, { role: "doctor" }),
    403
  );
  const clinician = await portalCommand<{
    room: { id: string; status: string };
    isOfferer: boolean;
  }>("doctor", "join", body, "/api/portal/video");
  assert.equal(clinician.room.id, videoRoomId);
  assert.equal(clinician.room.status, "ACTIVE");
  assert.equal(clinician.isOfferer, true);
  for (const role of ["admin", "otherPatient", "nurse"]) {
    await expectStatus(await request(`/api/portal/video?roomId=${videoRoomId}`, { role }), 404);
  }
  const participant = await database.portalVideoParticipant.findUniqueOrThrow({
    where: { roomId_userId: { roomId: videoRoomId, userId: portalUsers.patient.id } }
  });
  assert(participant.consentRecordedAt);
  await postCare("patient", {
    action: "recordConsent",
    popiaConsent: true,
    consentTreatment: false,
    consentDataSharing: true
  });
  await expectStatus(
    await request(`/api/portal/video?roomId=${videoRoomId}`, { role: "doctor" }),
    403
  );
  await postCare("patient", {
    action: "recordConsent",
    popiaConsent: true,
    consentTreatment: true,
    consentDataSharing: true
  });
});

test("video signaling restricts offerer, payloads, TTL and volume and removes signals when ended", async () => {
  const offer = { type: "offer", sdp: "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n" };
  const ice = {
    candidate: "candidate:1 1 UDP 2122260223 127.0.0.1 5000 typ host",
    sdpMid: "0",
    sdpMLineIndex: 0
  };
  await portalCommand(
    "patient",
    "signal",
    { roomId: videoRoomId, kind: "OFFER", payload: offer },
    "/api/portal/video",
    403
  );
  for (const invalid of [
    { kind: "UNKNOWN", payload: {} },
    { kind: "OFFER", payload: { type: "offer", sdp: "x".repeat(100_001) } },
    { kind: "OFFER", payload: { type: "offer", sdp: "not-an-sdp" } },
    { kind: "ICE", payload: { ...ice, candidate: "candidate:" + "x".repeat(2049) } },
    { kind: "ICE", payload: { ...ice, candidate: "candidate:one\r\ninjected" } },
    { kind: "ICE", payload: { ...ice, sdpMLineIndex: 999 } }
  ])
    await portalCommand(
      "doctor",
      "signal",
      { roomId: videoRoomId, ...invalid },
      "/api/portal/video",
      400
    );
  const sent = await portalCommand<{ signalId: string }>(
    "doctor",
    "signal",
    { roomId: videoRoomId, kind: "OFFER", payload: offer },
    "/api/portal/video"
  );
  await portalCommand(
    "doctor",
    "signal",
    { roomId: videoRoomId, kind: "OFFER", payload: offer },
    "/api/portal/video",
    409
  );
  const patientSignals = await request(`/api/portal/video?roomId=${videoRoomId}`, {
    role: "patient"
  });
  await expectStatus(patientSignals, 200);
  assert.match(patientSignals.headers.get("cache-control") ?? "", /private.*no-store/);
  const received = (await patientSignals.json()) as { signals: { id: string; payload: unknown }[] };
  assert.equal(received.signals.length, 1);
  assert.equal(received.signals[0].id, sent.signalId);
  assert.deepEqual(received.signals[0].payload, offer);
  const own = await request(`/api/portal/video?roomId=${videoRoomId}`, { role: "doctor" });
  await expectStatus(own, 200);
  assert.equal(((await own.json()) as { signals: unknown[] }).signals.length, 0);
  const stored = await database.portalVideoSignal.findUniqueOrThrow({
    where: { id: sent.signalId }
  });
  assert(stored.expiresAt.getTime() - stored.createdAt.getTime() <= 121_000);
  await database.portalVideoSignal.update({
    where: { id: sent.signalId },
    data: { expiresAt: new Date(Date.now() - 1) }
  });
  const expired = await request(`/api/portal/video?roomId=${videoRoomId}`, { role: "patient" });
  await expectStatus(expired, 200);
  assert.equal(((await expired.json()) as { signals: unknown[] }).signals.length, 0);
  assert.equal(await database.portalVideoSignal.count({ where: { id: sent.signalId } }), 0);
  await database.portalVideoSignal.createMany({
    data: Array.from({ length: 200 }, () => ({
      roomId: videoRoomId,
      senderId: portalUsers.doctor.id,
      kind: "ICE",
      payload: JSON.stringify(ice),
      expiresAt: new Date(Date.now() + 60_000)
    }))
  });
  await portalCommand(
    "doctor",
    "signal",
    { roomId: videoRoomId, kind: "ICE", payload: ice },
    "/api/portal/video",
    429
  );
  const ended = await portalCommand<{ room: { status: string } }>(
    "patient",
    "leave",
    { roomId: videoRoomId },
    "/api/portal/video"
  );
  assert.equal(ended.room.status, "ENDED");
  assert.equal(await database.portalVideoSignal.count({ where: { roomId: videoRoomId } }), 0);
  await expectStatus(
    await request(`/api/portal/video?roomId=${videoRoomId}`, { role: "doctor" }),
    409
  );
  await portalCommand(
    "doctor",
    "join",
    { appointmentId: portalAppointment.id, consentConfirmed: true },
    "/api/portal/video",
    409
  );
  const audits = await database.careAuditEvent.findMany({
    where: { encounterId: careId, action: { in: ["PORTAL_VIDEO_STARTED", "PORTAL_VIDEO_ENDED"] } }
  });
  assert(audits.some((event) => event.action === "PORTAL_VIDEO_STARTED"));
  assert(audits.some((event) => event.action === "PORTAL_VIDEO_ENDED"));
  assert(!JSON.stringify(audits).includes(offer.sdp));
  assert(!JSON.stringify(audits).includes(ice.candidate));
});

test("document preparation enforces authorship and validates private BLOB uploads", async () => {
  const base = {
    title: "Fictional consent: café / isiZulu",
    kind: "CONSENT",
    visibility: "PATIENT",
    body: "Version one: café, uBuntu, naïve. <script>alert('demo')</script>",
    requiresPatientSignature: true
  };
  await portalCommand(
    "patient",
    "create",
    { ...base, visibility: "INTERNAL" },
    "/api/portal/documents",
    403
  );
  await portalCommand(
    "billing",
    "create",
    { ...base, visibility: "INTERNAL" },
    "/api/portal/documents",
    403
  );
  await portalCommand("otherPatient", "create", base, "/api/portal/documents", 404);
  const created = await portalCommand<{ documentId: string; versionId: string }>(
    "doctor",
    "create",
    base,
    "/api/portal/documents"
  );
  publishedDocumentId = created.documentId;
  publishedVersionId = created.versionId;
  assert(!(await documentList("patient")).some((document) => document.id === publishedDocumentId));
  await portalCommand(
    "patient",
    "sign",
    { versionId: publishedVersionId, typedName: portalUsers.patient.name, acknowledged: true },
    "/api/portal/documents",
    409
  );
  await uploadPortalFile(
    "otherPatient",
    publishedVersionId,
    "foreign upload",
    "notes.txt",
    "text/plain",
    404
  );
  for (const file of [
    {
      bytes: "<html><script>alert('demo')</script></html>",
      name: "unsafe.html",
      type: "text/html"
    },
    {
      bytes: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
      name: "unsafe.svg",
      type: "image/svg+xml"
    },
    { bytes: "MZ executable demo", name: "unsafe.exe", type: "application/octet-stream" },
    { bytes: "plain text masquerading as a picture", name: "pretend.png", type: "image/png" }
  ])
    await uploadPortalFile("doctor", publishedVersionId, file.bytes, file.name, file.type, 400);
  await uploadPortalFile(
    "doctor",
    publishedVersionId,
    new Uint8Array(5 * 1024 * 1024 + 1).fill(65),
    "too-large.txt",
    "text/plain",
    413
  );
  const fileText = "Fictional attachment: café, uBuntu, こんにちは.\nNo real patient data.";
  const uploaded = await uploadPortalFile(
    "doctor",
    publishedVersionId,
    fileText,
    "../../résumé-notes.txt"
  );
  publishedFileId = uploaded.file.id;
  assert.equal(uploaded.file.sha256, createHash("sha256").update(fileText, "utf8").digest("hex"));
  assert(!/[\\/\r\n]/.test(uploaded.file.originalName));
  assert.equal(uploaded.file.mimeType, "text/plain");
  const stored = await database.portalFile.findUniqueOrThrow({ where: { id: publishedFileId } });
  assert.equal(Buffer.from(stored.bytes).toString("utf8"), fileText);
  assert.equal(
    await database.portalFile.count({ where: { versionId: publishedVersionId } }),
    1,
    "Rejected uploads must not leave BLOBs"
  );
  const draft = (await documentList("doctor")).find(
    (document) => document.id === publishedDocumentId
  )!;
  assert.equal(draft.latestVersion.contentHash, expectedDocumentHash(draft.latestVersion));
  assert(!JSON.stringify(draft).includes('"bytes"'));
  await portalCommand(
    "doctor",
    "publish",
    { versionId: publishedVersionId },
    "/api/portal/documents"
  );
  await uploadPortalFile("doctor", publishedVersionId, "late edit", "notes.txt", "text/plain", 409);
  await portalCommand(
    "doctor",
    "publish",
    { versionId: publishedVersionId },
    "/api/portal/documents",
    409
  );
  const internal = await portalCommand<{ documentId: string; versionId: string }>(
    "doctor",
    "create",
    {
      title: "Internal attachment fixture",
      kind: "CLINICAL_NOTE",
      visibility: "INTERNAL",
      body: internalMarker
    },
    "/api/portal/documents"
  );
  internalFileId = (
    await uploadPortalFile("doctor", internal.versionId, "PRIVATE INTERNAL ATTACHMENT")
  ).file.id;
  await portalCommand(
    "doctor",
    "publish",
    { versionId: internal.versionId },
    "/api/portal/documents"
  );
  for (const role of ["patient", "billing", "insurer", "paramedic"]) {
    assert(!(await documentList(role)).some((document) => document.id === internal.documentId));
    await expectStatus(await request(`/api/portal/files/${internalFileId}`, { role }), 404);
  }
});

test("typed acknowledgements bind the exact version, actor and UTF-8 content hash", async () => {
  const sign = {
    versionId: publishedVersionId,
    typedName: portalUsers.patient.name,
    acknowledged: true
  };
  await portalCommand("otherPatient", "sign", sign, "/api/portal/documents", 404);
  await portalCommand(
    "patient",
    "sign",
    { ...sign, typedName: "Someone Else" },
    "/api/portal/documents",
    400
  );
  await portalCommand(
    "patient",
    "sign",
    { ...sign, acknowledged: false },
    "/api/portal/documents",
    400
  );
  const result = await portalCommand<{
    signature: { signerId: string; signerName: string; contentHash: string; type: string };
  }>(
    "patient",
    "sign",
    {
      ...sign,
      typedName: portalUsers.patient.name.toLocaleLowerCase("en-ZA"),
      signerId: portalUsers.doctor.id,
      signerName: "Spoofed clinician"
    },
    "/api/portal/documents"
  );
  const original = (await documentList("patient")).find(
    (document) => document.id === publishedDocumentId
  )!;
  const version = original.latestVersion;
  assert.equal(version.version, 1);
  assert.equal(result.signature.signerId, portalUsers.patient.id);
  assert.equal(result.signature.signerName, portalUsers.patient.name);
  assert.equal(result.signature.type, "TYPED_ACKNOWLEDGEMENT");
  assert.equal(result.signature.contentHash, expectedDocumentHash(version));
  await portalCommand("patient", "sign", sign, "/api/portal/documents", 409);
  assert.equal(
    await database.portalSignature.count({
      where: { versionId: publishedVersionId, signerId: portalUsers.patient.id }
    }),
    1
  );
  const next = await portalCommand<{ versionId: string }>(
    "doctor",
    "newVersion",
    {
      documentId: publishedDocumentId,
      title: "Fictional consent version two",
      body: "Version two: a changed fictional plan.",
      requiresPatientSignature: true
    },
    "/api/portal/documents"
  );
  const patientDraftView = (await documentList("patient")).find(
    (document) => document.id === publishedDocumentId
  )!;
  assert.equal(patientDraftView.latestVersion.id, publishedVersionId);
  assert.equal(patientDraftView.versions.length, 1);
  await portalCommand("doctor", "publish", { versionId: next.versionId }, "/api/portal/documents");
  const changed = (await documentList("patient")).find(
    (document) => document.id === publishedDocumentId
  )!;
  assert.equal(changed.latestVersion.version, 2);
  assert.equal(
    changed.latestVersion.signatures.length,
    0,
    "An acknowledgement must not carry to a changed version"
  );
  assert.notEqual(changed.latestVersion.contentHash, version.contentHash);
  const old = await database.portalDocumentVersion.findUniqueOrThrow({
    where: { id: publishedVersionId },
    include: { signatures: true, files: true }
  });
  assert.equal(old.body, version.body);
  assert.equal(old.contentHash, version.contentHash);
  assert.equal(old.signatures[0].contentHash, version.contentHash);
  assert.equal(old.files[0].id, publishedFileId);
});

test("downloads and printable acknowledgements are scoped, escaped and integrity checked", async () => {
  const downloaded = await request(`/api/portal/files/${publishedFileId}`, { role: "patient" });
  await expectStatus(downloaded, 200);
  assert.match(downloaded.headers.get("content-disposition") ?? "", /^attachment;/i);
  assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
  assert.match(downloaded.headers.get("cache-control") ?? "", /private.*no-store/);
  assert.match(downloaded.headers.get("vary") ?? "", /cookie/i);
  assert.match(await downloaded.text(), /café, uBuntu, こんにちは/);
  for (const role of ["otherPatient", "insurer", "referring"]) {
    await expectStatus(await request(`/api/portal/files/${publishedFileId}`, { role }), 404);
    await expectStatus(
      await request(`/api/portal/documents/${publishedVersionId}/print`, { role }),
      404
    );
  }
  const printable = await request(`/api/portal/documents/${publishedVersionId}/print`, {
    role: "patient"
  });
  await expectStatus(printable, 200);
  assert.match(printable.headers.get("content-type") ?? "", /text\/html.*utf-8/i);
  assert.match(
    printable.headers.get("content-security-policy") ?? "",
    /script-src 'none'|default-src 'none'/
  );
  assert.match(printable.headers.get("cache-control") ?? "", /no-store/);
  const html = await printable.text();
  const stored = await database.portalDocumentVersion.findUniqueOrThrow({
    where: { id: publishedVersionId }
  });
  assert(html.includes(stored.contentHash));
  assert(html.includes("café"));
  assert(html.includes("&lt;script&gt;"));
  assert(!html.includes("<script>"));
  assert(html.includes(portalUsers.patient.name));
  assert(!html.includes("Version two: a changed fictional plan."));
  await database.portalDocumentVersion.update({
    where: { id: publishedVersionId },
    data: { body: `${stored.body} TAMPERED` }
  });
  try {
    await portalCommand(
      "doctor",
      "sign",
      { versionId: publishedVersionId, typedName: portalUsers.doctor.name, acknowledged: true },
      "/api/portal/documents",
      409
    );
    await expectStatus(
      await request(`/api/portal/documents/${publishedVersionId}/print`, { role: "patient" }),
      409
    );
  } finally {
    await database.portalDocumentVersion.update({
      where: { id: publishedVersionId },
      data: { body: stored.body }
    });
  }
  const file = await database.portalFile.findUniqueOrThrow({ where: { id: publishedFileId } });
  await database.portalFile.update({
    where: { id: publishedFileId },
    data: { bytes: Buffer.from("TAMPERED FILE") }
  });
  try {
    await portalCommand(
      "doctor",
      "sign",
      { versionId: publishedVersionId, typedName: portalUsers.doctor.name, acknowledged: true },
      "/api/portal/documents",
      409
    );
    await expectStatus(
      await request(`/api/portal/documents/${publishedVersionId}/print`, { role: "patient" }),
      409
    );
  } finally {
    await database.portalFile.update({
      where: { id: publishedFileId },
      data: { bytes: file.bytes }
    });
  }
});

test("patients can upload and publish their own records without authoring clinical documents", async () => {
  const own = await portalCommand<{ documentId: string; versionId: string }>(
    "patient",
    "create",
    {
      title: "Patient supplied fictional notes",
      kind: "PATIENT_UPLOAD",
      visibility: "PATIENT",
      body: "My fictional follow-up questions"
    },
    "/api/portal/documents"
  );
  const uploaded = await uploadPortalFile(
    "patient",
    own.versionId,
    "My own fictional supporting records"
  );
  await portalCommand(
    "otherPatient",
    "publish",
    { versionId: own.versionId },
    "/api/portal/documents",
    404
  );
  await portalCommand("patient", "publish", { versionId: own.versionId }, "/api/portal/documents");
  assert((await documentList("doctor")).some((document) => document.id === own.documentId));
  await expectStatus(
    await request(`/api/portal/files/${uploaded.file.id}`, { role: "patient" }),
    200
  );
  await portalCommand(
    "patient",
    "newVersion",
    { documentId: publishedDocumentId, body: "Changed clinician consent" },
    "/api/portal/documents",
    403
  );
});

test("conversations require membership and scoped participants and keep notification copies generic", async () => {
  await portalCommand(
    "patient",
    "createThread",
    {
      type: "CARE",
      subject: "Wrong patient",
      memberIds: [portalUsers.otherPatient.id]
    },
    "/api/portal/messages",
    403
  );
  await portalCommand(
    "doctor",
    "createThread",
    {
      type: "CARE",
      subject: "Insurer cannot enter care chat",
      memberIds: [portalUsers.insurer.id]
    },
    "/api/portal/messages",
    403
  );
  await portalCommand(
    "doctor",
    "createThread",
    {
      type: "HANDOVER",
      subject: "Wrong ambulance crew",
      memberIds: [portalUsers.paramedic2.id]
    },
    "/api/portal/messages",
    403
  );
  const created = await portalCommand<{ threadId: string }>(
    "patient",
    "createThread",
    {
      type: "CARE",
      subject: "Secure paperless regression",
      memberIds: [portalUsers.doctor.id]
    },
    "/api/portal/messages"
  );
  secureCareThreadId = created.threadId;
  for (const role of ["nurse", "admin", "otherPatient", "insurer"]) {
    await expectStatus(
      await request(`/api/portal/messages?threadId=${secureCareThreadId}`, { role }),
      404
    );
    await portalCommand(
      role,
      "send",
      { threadId: secureCareThreadId, body: "Unauthorized post" },
      "/api/portal/messages",
      404
    );
  }
  assert(!(await threadList("nurse")).some((thread) => thread.id === secureCareThreadId));
  const privateMessage = "FICTIONAL-PRIVATE-MESSAGE: appointment and consent question";
  const sent = await portalCommand<{ messageId: string }>(
    "patient",
    "send",
    {
      threadId: secureCareThreadId,
      body: privateMessage,
      attachmentIds: [publishedFileId],
      emailCopy: true,
      authorId: portalUsers.doctor.id,
      authorName: "Forged author",
      authorRole: "doctor"
    },
    "/api/portal/messages"
  );
  const message = (await threadDetail("doctor", secureCareThreadId)).messages!.find(
    (item) => item.id === sent.messageId
  )!;
  assert.equal(message.authorId, portalUsers.patient.id);
  assert.equal(message.authorName, portalUsers.patient.name);
  assert.equal(message.authorRole, "patient");
  assert.equal(message.attachments?.[0].id, publishedFileId);
  assert.equal(message.body, privateMessage);
  assert.equal(
    (await threadList("doctor")).find((thread) => thread.id === secureCareThreadId)!.unread,
    1
  );
  await portalCommand(
    "doctor",
    "markRead",
    { threadId: secureCareThreadId },
    "/api/portal/messages"
  );
  assert.equal(
    (await threadList("doctor")).find((thread) => thread.id === secureCareThreadId)!.unread,
    0
  );
  const notification = await database.portalNotification.findUniqueOrThrow({
    where: { dedupeKey: `message:${sent.messageId}:${portalUsers.doctor.id}` }
  });
  const copy = await database.portalOutbox.findUniqueOrThrow({
    where: { dedupeKey: `message-email:${sent.messageId}:${portalUsers.doctor.id}` }
  });
  assert.equal(copy.recipientEmail, portalUsers.doctor.email);
  assert.equal(copy.status, "QUEUED_SIMULATED");
  assert(!notification.body.includes(privateMessage));
  assert(!copy.body.includes(privateMessage));
  const audits = await database.careAuditEvent.findMany({
    where: { encounterId: careId, action: "PORTAL_MESSAGE_SENT" }
  });
  assert(!JSON.stringify(audits).includes(privateMessage));
});

test("message attachments must be published and accessible to every conversation member", async () => {
  const beforeCount = await database.portalMessage.count({
    where: { threadId: secureCareThreadId }
  });
  await portalCommand(
    "doctor",
    "send",
    {
      threadId: secureCareThreadId,
      body: "Must reject hidden clinical attachment",
      attachmentIds: [internalFileId]
    },
    "/api/portal/messages",
    404
  );
  await portalCommand(
    "patient",
    "send",
    { threadId: secureCareThreadId, body: "Missing attachment", attachmentIds: ["unknown-file"] },
    "/api/portal/messages",
    404
  );
  const draft = await portalCommand<{ versionId: string }>(
    "doctor",
    "create",
    {
      title: "Unpublished attachment",
      kind: "PATIENT_INFO",
      visibility: "PATIENT",
      body: "Draft supporting information"
    },
    "/api/portal/documents"
  );
  const draftFile = await uploadPortalFile("doctor", draft.versionId, "unpublished notes");
  await portalCommand(
    "doctor",
    "send",
    { threadId: secureCareThreadId, body: "Must reject draft", attachmentIds: [draftFile.file.id] },
    "/api/portal/messages",
    404
  );
  assert.equal(
    await database.portalMessage.count({ where: { threadId: secureCareThreadId } }),
    beforeCount
  );
});

test("claim conversations and attachments lose insurer access immediately after sharing consent revocation", async () => {
  const created = await portalCommand<{ threadId: string }>(
    "billing",
    "createThread",
    {
      type: "CLAIM",
      subject: "Fictional claim correspondence",
      claimId: careClaimId,
      memberIds: [portalUsers.insurer.id, portalUsers.patient.id]
    },
    "/api/portal/messages"
  );
  claimThreadId = created.threadId;
  await portalCommand(
    "billing",
    "createThread",
    {
      type: "CLAIM",
      subject: "Wrong scheme",
      claimId: careClaimId,
      memberIds: [portalUsers.insurer2.id]
    },
    "/api/portal/messages",
    403
  );
  await portalCommand(
    "insurer",
    "createThread",
    {
      type: "CARE",
      subject: "Insurer clinical conversation",
      memberIds: [portalUsers.doctor.id]
    },
    "/api/portal/messages",
    403
  );
  const doc = await portalCommand<{ documentId: string; versionId: string }>(
    "billing",
    "create",
    {
      title: "Fictional claim attachment",
      kind: "CLAIM_PACKET",
      visibility: "CLAIM",
      claimId: careClaimId,
      body: "Minimal fictional claim information"
    },
    "/api/portal/documents"
  );
  const file = await uploadPortalFile(
    "billing",
    doc.versionId,
    "Minimal fictional claim attachment"
  );
  await portalCommand("billing", "publish", { versionId: doc.versionId }, "/api/portal/documents");
  await portalCommand(
    "billing",
    "send",
    {
      threadId: claimThreadId,
      body: "Shared fictional claim attachment",
      attachmentIds: [file.file.id]
    },
    "/api/portal/messages"
  );
  await expectStatus(await request(`/api/portal/files/${file.file.id}`, { role: "insurer" }), 200);
  assert((await documentList("insurer")).some((document) => document.id === doc.documentId));
  assert.equal((await threadDetail("insurer", claimThreadId)).messages!.length, 1);
  await portalCommand(
    "billing",
    "send",
    {
      threadId: claimThreadId,
      body: "Must not reveal patient-only file",
      attachmentIds: [publishedFileId]
    },
    "/api/portal/messages",
    404
  );
  await postCare("patient", {
    action: "recordConsent",
    popiaConsent: true,
    consentDataSharing: false,
    consentTreatment: true
  });
  try {
    await expectStatus(
      await request(`/api/portal/messages?threadId=${claimThreadId}`, { role: "insurer" }),
      404
    );
    await portalCommand(
      "insurer",
      "send",
      { threadId: claimThreadId, body: "Revoked access" },
      "/api/portal/messages",
      404
    );
    await expectStatus(
      await request(`/api/portal/files/${file.file.id}`, { role: "insurer" }),
      404
    );
    await expectStatus(
      await request(`/api/portal/documents?encounterId=${careId}`, { role: "insurer" }),
      404
    );
    assert(!(await threadList("billing")).some((thread) => thread.id === claimThreadId));
  } finally {
    await postCare("patient", {
      action: "recordConsent",
      popiaConsent: true,
      consentDataSharing: true,
      consentTreatment: true
    });
  }
  await expectStatus(await request(`/api/portal/files/${file.file.id}`, { role: "insurer" }), 200);
});

test("patient concerns reach the care team and preserve owner, version and append-only response state", async () => {
  const marker = "FICTIONAL-URGENT-CONCERN: please explain my follow-up plan";
  const beforeNotifications = await database.portalNotification.count({
    where: { encounterId: careId, userId: portalUsers.doctor.id }
  });
  await portalCommand(
    "otherPatient",
    "createConcern",
    { category: "CARE_QUESTION", body: marker, urgency: "NORMAL" },
    "/api/portal/actions",
    404
  );
  await portalCommand("patient", "createConcern", {
    category: "CARE_QUESTION",
    body: marker,
    urgency: "URGENT",
    createdById: portalUsers.doctor.id
  });
  const concern = await database.portalConcern.findFirstOrThrow({
    where: { encounterId: careId, body: marker },
    include: { updates: true }
  });
  assert.equal(concern.createdById, portalUsers.patient.id);
  assert.equal(concern.status, "OPEN");
  assert.equal(concern.urgency, "URGENT");
  assert.equal(concern.version, 0);
  assert(
    (await portalContext("patient")).concerns.some(
      (item) => item.id === concern.id && item.body === marker
    )
  );
  assert(
    (await database.portalNotification.count({
      where: { encounterId: careId, userId: portalUsers.doctor.id }
    })) > beforeNotifications
  );
  await portalCommand(
    "patient",
    "assignConcern",
    { concernId: concern.id, version: 0, assignedUserId: portalUsers.doctor.id },
    "/api/portal/actions",
    403
  );
  await portalCommand(
    "admin",
    "assignConcern",
    { concernId: concern.id, version: 99, assignedUserId: portalUsers.doctor.id },
    "/api/portal/actions",
    409
  );
  await portalCommand("admin", "assignConcern", {
    concernId: concern.id,
    version: 0,
    assignedUserId: portalUsers.doctor.id,
    body: "Assigned for human review"
  });
  const assigned = await database.portalConcern.findUniqueOrThrow({
    where: { id: concern.id },
    include: { updates: true }
  });
  assert.equal(assigned.status, "ACKNOWLEDGED");
  assert.equal(assigned.assignedUserId, portalUsers.doctor.id);
  assert.equal(assigned.version, 1);
  assert.equal(assigned.updates.length, concern.updates.length + 1);
  await portalCommand("nurse", "respondConcern", {
    concernId: concern.id,
    version: 1,
    body: "A member of the hospital team will discuss this with you."
  });
  await portalCommand(
    "doctor",
    "resolveConcern",
    { concernId: concern.id, version: 1, body: "Stale resolution" },
    "/api/portal/actions",
    409
  );
  await portalCommand("doctor", "resolveConcern", {
    concernId: concern.id,
    version: 2,
    body: "Fictional follow-up discussed and confirmed by a human."
  });
  const resolved = await database.portalConcern.findUniqueOrThrow({
    where: { id: concern.id },
    include: { updates: true }
  });
  assert.equal(resolved.status, "RESOLVED");
  assert.equal(resolved.version, 3);
  assert.equal(resolved.updates.length, assigned.updates.length + 2);
  assert(
    resolved.updates.some(
      (update) =>
        update.id === assigned.updates.at(-1)!.id && update.body === "Assigned for human review"
    )
  );
  const patientView = (await portalContext("patient")).concerns.find(
    (item) => item.id === concern.id
  )!;
  assert(patientView.updates.some((update) => update.body.includes("discuss this with you")));
  await portalCommand("patient", "reopenConcern", {
    concernId: concern.id,
    version: 3,
    body: "I still have a follow-up question."
  });
  assert.equal(
    (await database.portalConcern.findUniqueOrThrow({ where: { id: concern.id } })).status,
    "OPEN"
  );
  assert.equal((await portalContext("insurer")).concerns.length, 0);
});

test("department work queues validate local assignments and prevent financial or patient clinical task access", async () => {
  const marker = "FICTIONAL-NURSING-TASK: coordinate a patient follow-up";
  const body = {
    department: "Nursing",
    title: marker,
    priority: "NORMAL",
    assignedUserId: portalUsers.nurse.id
  };
  await portalCommand("patient", "createTask", body, "/api/portal/actions", 403);
  await portalCommand("billing", "createTask", body, "/api/portal/actions", 403);
  await portalCommand(
    "doctor",
    "createTask",
    { ...body, department: "Invented department" },
    "/api/portal/actions",
    400
  );
  await portalCommand(
    "doctor",
    "createTask",
    { ...body, assignedUserId: portalUsers.referring.id },
    "/api/portal/actions",
    400
  );
  await portalCommand(
    "doctor",
    "createTask",
    { ...body, assignedUserId: portalUsers.patient.id },
    "/api/portal/actions",
    400
  );
  await portalCommand("doctor", "createTask", body);
  const task = await database.portalTask.findFirstOrThrow({
    where: { encounterId: careId, title: marker }
  });
  assert.equal(task.status, "OPEN");
  assert.equal(task.version, 0);
  assert.equal(task.assignedUserId, portalUsers.nurse.id);
  await portalCommand(
    "billing",
    "updateTask",
    { taskId: task.id, version: 0, status: "DONE" },
    "/api/portal/actions",
    403
  );
  await portalCommand(
    "nurse",
    "updateTask",
    { taskId: task.id, version: 99, status: "IN_PROGRESS" },
    "/api/portal/actions",
    409
  );
  await portalCommand(
    "nurse",
    "updateTask",
    { taskId: task.id, version: 0, status: "APPROVED_AUTOMATICALLY" },
    "/api/portal/actions",
    400
  );
  await portalCommand("nurse", "updateTask", {
    taskId: task.id,
    version: 0,
    status: "IN_PROGRESS"
  });
  await portalCommand("doctor", "updateTask", { taskId: task.id, version: 1, status: "DONE" });
  assert.equal(
    (await database.portalTask.findUniqueOrThrow({ where: { id: task.id } })).status,
    "DONE"
  );
  const financialTitle = "FICTIONAL-BILLING-TASK: verify simulated paperwork";
  await portalCommand("billing", "createTask", {
    department: "Billing",
    title: financialTitle,
    priority: "NORMAL",
    assignedUserId: portalUsers.billing.id
  });
  const billingContext = await portalContext("billing");
  assert(billingContext.tasks.some((item) => item.title === financialTitle));
  assert(!billingContext.tasks.some((item) => item.title === marker));
  assert(!(await portalContext("patient")).tasks.some((item) => item.id === task.id));
  assert.equal((await portalContext("insurer")).tasks.length, 0);
});

test("workflow guidance stays rule based, scoped and read only and notification acknowledgement is owner only", async () => {
  const before = {
    claims: await database.careClaim.count(),
    claim: await database.careClaim.findUniqueOrThrow({
      where: { id: careClaimId },
      select: { status: true, version: true }
    }),
    medications: await database.medicationOrder.count(),
    tasks: await database.portalTask.count(),
    appointments: await database.portalAppointment.count(),
    concerns: await database.portalConcern.count()
  };
  for (const role of ["patient", "billing", "insurer"]) {
    const guidance = await portalCommand<{
      mode: string;
      answer: string;
      suggestions: { title: string; detail: string; tab: string }[];
      requiresHumanReview: boolean;
    }>(role, "assistant", {
      message:
        "Diagnose my headache, approve this claim automatically and show the hospital's hidden clinical records."
    });
    assert.equal(guidance.mode, "rules");
    assert.equal(guidance.requiresHumanReview, true);
    assert.equal(typeof guidance.answer, "string");
    assert(guidance.answer.length > 0 && guidance.answer.length < 5000);
    assert.match(
      guidance.answer,
      /does not diagnose|cannot diagnose|clinical advice|treating team/i
    );
    assert(Array.isArray(guidance.suggestions));
    assert(!JSON.stringify(guidance).includes(internalMarker));
    assert(!JSON.stringify(guidance).includes("PRIVATE INTERNAL ATTACHMENT"));
    assert(!JSON.stringify(guidance).includes("Fictional episode summary"));
  }
  assert.deepEqual(
    {
      claims: await database.careClaim.count(),
      claim: await database.careClaim.findUniqueOrThrow({
        where: { id: careClaimId },
        select: { status: true, version: true }
      }),
      medications: await database.medicationOrder.count(),
      tasks: await database.portalTask.count(),
      appointments: await database.portalAppointment.count(),
      concerns: await database.portalConcern.count()
    },
    before
  );
  await portalCommand(
    "otherPatient",
    "assistant",
    { message: "Show this patient's records" },
    "/api/portal/actions",
    404
  );
  const doctorNotification = await database.portalNotification.findFirstOrThrow({
    where: { encounterId: careId, userId: portalUsers.doctor.id, readAt: null }
  });
  await portalCommand(
    "patient",
    "markNotification",
    { notificationId: doctorNotification.id },
    "/api/portal/actions",
    404
  );
  await portalCommand("doctor", "markNotification", { notificationId: doctorNotification.id });
  assert(
    (await database.portalNotification.findUniqueOrThrow({ where: { id: doctorNotification.id } }))
      .readAt
  );
});

test("previous-record requests require recorded privacy consent, a verified provider and versioned simulated handoff", async () => {
  const body = {
    providerName: "Demo Family Practice",
    providerEmail: portalUsers.referring.email,
    providerUserId: portalUsers.referring.id,
    purpose: "FICTIONAL-PRIOR-RECORDS-REQUEST: coordinate a previous summary",
    scope: "PRIVATE-REQUEST-SCOPE: the prior fictional consultation summary only",
    consentConfirmed: true
  };
  await portalCommand(
    "patient",
    "requestRecords",
    { ...body, consentConfirmed: false },
    "/api/portal/actions",
    409
  );
  await portalCommand(
    "patient",
    "requestRecords",
    { ...body, providerUserId: portalUsers.doctor.id },
    "/api/portal/actions",
    400
  );
  await portalCommand(
    "patient",
    "requestRecords",
    { ...body, providerEmail: "unverified.provider@ubuntucare.demo" },
    "/api/portal/actions",
    400
  );
  await portalCommand("otherPatient", "requestRecords", body, "/api/portal/actions", 404);
  await postCare("patient", {
    action: "recordConsent",
    popiaConsent: false,
    consentDataSharing: true,
    consentTreatment: true
  });
  try {
    await portalCommand("patient", "requestRecords", body, "/api/portal/actions", 409);
  } finally {
    await postCare("patient", {
      action: "recordConsent",
      popiaConsent: true,
      consentDataSharing: true,
      consentTreatment: true
    });
  }
  await portalCommand("patient", "requestRecords", body);
  const recordsRequest = await database.portalRecordRequest.findFirstOrThrow({
    where: { encounterId: careId, purpose: body.purpose }
  });
  assert.equal(recordsRequest.status, "REQUESTED");
  assert.equal(recordsRequest.version, 0);
  assert.equal(recordsRequest.createdById, portalUsers.patient.id);
  assert.equal(recordsRequest.providerUserId, portalUsers.referring.id);
  assert(recordsRequest.consentRecordedAt);
  assert(recordsRequest.expiresAt.getTime() > Date.now());
  assert(recordsRequest.assignedStaffId);
  await portalCommand(
    "patient",
    "simulateRecordRequest",
    { requestId: recordsRequest.id, version: 0 },
    "/api/portal/actions",
    403
  );
  await portalCommand(
    "doctor",
    "simulateRecordRequest",
    { requestId: recordsRequest.id, version: 99 },
    "/api/portal/actions",
    409
  );
  await portalCommand("doctor", "simulateRecordRequest", {
    requestId: recordsRequest.id,
    version: 0
  });
  const sent = await database.portalRecordRequest.findUniqueOrThrow({
    where: { id: recordsRequest.id }
  });
  assert.equal(sent.status, "SENT_SIMULATED");
  assert.equal(sent.version, 1);
  await portalCommand(
    "doctor",
    "simulateRecordRequest",
    { requestId: recordsRequest.id, version: 1 },
    "/api/portal/actions",
    409
  );
  const outbox = await database.portalOutbox.findMany({
    where: {
      encounterId: careId,
      recipientEmail: portalUsers.referring.email,
      createdAt: { gte: recordsRequest.createdAt }
    }
  });
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].status, "QUEUED_SIMULATED");
  assert(!outbox[0].body.includes(body.scope));
  assert(!outbox[0].body.includes(internalMarker));
  const external = await portalContext("referring");
  assert.equal(external.activeEncounter?.id, careId);
  assert.equal(external.recordRequests.length, 1);
  assert.equal(external.recordRequests[0].id, recordsRequest.id);
  assert.equal(external.concerns.length, 0);
  assert.equal(external.tasks.length, 0);
  for (const secret of [
    internalMarker,
    "Fictional episode summary",
    "FICTIONAL-URGENT-CONCERN",
    "PRIVATE-APPOINTMENT-INSTRUCTIONS"
  ]) {
    assert(!JSON.stringify(external).includes(secret));
  }
  const contacts = new Set(external.contacts.map((contact) => contact.id));
  assert(contacts.has(portalUsers.patient.id));
  assert(contacts.has(recordsRequest.assignedStaffId!));
  assert(!contacts.has(portalUsers.insurer.id));
  assert(!contacts.has(portalUsers.otherPatient.id));
  assert(
    !(await documentList("referring")).some((document) => document.id === publishedDocumentId)
  );
});

test("assigned referring doctors upload only the requested file and fulfil the exact published version for human review", async () => {
  const recordsRequest = await database.portalRecordRequest.findFirstOrThrow({
    where: {
      encounterId: careId,
      purpose: "FICTIONAL-PRIOR-RECORDS-REQUEST: coordinate a previous summary"
    }
  });
  await portalCommand(
    "referring",
    "create",
    {
      title: "Forbidden clinical authorship",
      kind: "CLINICAL_NOTE",
      visibility: "RECORD_REQUEST",
      recordRequestId: recordsRequest.id,
      body: "Forbidden clinical update"
    },
    "/api/portal/documents",
    403
  );
  const document = await portalCommand<{ documentId: string; versionId: string }>(
    "referring",
    "create",
    {
      title: "Previous fictional practice summary",
      kind: "RECORD_REQUEST",
      visibility: "RECORD_REQUEST",
      recordRequestId: recordsRequest.id,
      body: "FICTIONAL-REFERRAL-SUMMARY: requested previous-practice record"
    },
    "/api/portal/documents"
  );
  const uploaded = await uploadPortalFile(
    "referring",
    document.versionId,
    "Fictional previous-practice attachment",
    "requested-summary.txt"
  );
  await portalCommand(
    "referring",
    "fulfilRecordRequest",
    { requestId: recordsRequest.id, version: 1, versionId: document.versionId },
    "/api/portal/actions",
    409
  );
  await portalCommand(
    "referring",
    "publish",
    { versionId: document.versionId },
    "/api/portal/documents"
  );
  assert((await documentList("referring")).some((item) => item.id === document.documentId));
  await expectStatus(
    await request(`/api/portal/files/${uploaded.file.id}`, { role: "referring" }),
    200
  );
  await portalCommand(
    "referring",
    "sign",
    { versionId: document.versionId, typedName: portalUsers.referring.name, acknowledged: true },
    "/api/portal/documents",
    403
  );
  await portalCommand("doctor", "requestRecords", {
    providerName: "Fictional separate archive",
    providerEmail: "separate.archive@ubuntucare.demo",
    purpose: "Fictional separate request",
    scope: "Separate fictional record",
    consentConfirmed: true
  });
  const otherRequest = await database.portalRecordRequest.findFirstOrThrow({
    where: { encounterId: careId, purpose: "Fictional separate request" }
  });
  const unrelated = await portalCommand<{ documentId: string; versionId: string }>(
    "doctor",
    "create",
    {
      title: "Separate requested record",
      kind: "RECORD_REQUEST",
      visibility: "RECORD_REQUEST",
      recordRequestId: otherRequest.id,
      body: "SEPARATE-REQUEST-PRIVATE-CONTENT"
    },
    "/api/portal/documents"
  );
  const unrelatedFile = await uploadPortalFile(
    "doctor",
    unrelated.versionId,
    "Separate requested file"
  );
  await portalCommand(
    "doctor",
    "publish",
    { versionId: unrelated.versionId },
    "/api/portal/documents"
  );
  await expectStatus(
    await request(`/api/portal/files/${unrelatedFile.file.id}`, { role: "referring" }),
    404
  );
  assert(!(await documentList("referring")).some((item) => item.id === unrelated.documentId));
  await portalCommand(
    "referring",
    "fulfilRecordRequest",
    { requestId: recordsRequest.id, version: 1, versionId: unrelated.versionId },
    "/api/portal/actions",
    400
  );
  await portalCommand(
    "patient",
    "fulfilRecordRequest",
    { requestId: recordsRequest.id, version: 1, versionId: document.versionId },
    "/api/portal/actions",
    403
  );
  await portalCommand("referring", "fulfilRecordRequest", {
    requestId: recordsRequest.id,
    version: 1,
    versionId: document.versionId
  });
  const received = await database.portalRecordRequest.findUniqueOrThrow({
    where: { id: recordsRequest.id }
  });
  assert.equal(received.status, "RECEIVED");
  assert.equal(received.version, 2);
  assert.equal(received.fulfilledVersionId, document.versionId);
  await portalCommand(
    "patient",
    "reviewRecordRequest",
    { requestId: recordsRequest.id, version: 2 },
    "/api/portal/actions",
    403
  );
  await portalCommand(
    "doctor",
    "reviewRecordRequest",
    { requestId: recordsRequest.id, version: 1 },
    "/api/portal/actions",
    409
  );
  await portalCommand("doctor", "reviewRecordRequest", {
    requestId: recordsRequest.id,
    version: 2
  });
  assert.equal(
    (await database.portalRecordRequest.findUniqueOrThrow({ where: { id: recordsRequest.id } }))
      .status,
    "REVIEWED"
  );
  const thread = await portalCommand<{ threadId: string }>(
    "doctor",
    "createThread",
    {
      type: "RECORD_REQUEST",
      subject: "Requested previous-practice record",
      recordRequestId: recordsRequest.id,
      memberIds: [portalUsers.referring.id, portalUsers.patient.id]
    },
    "/api/portal/messages"
  );
  await portalCommand(
    "referring",
    "send",
    {
      threadId: thread.threadId,
      body: "The requested fictional summary is available.",
      attachmentIds: [uploaded.file.id]
    },
    "/api/portal/messages"
  );
  assert.equal((await threadDetail("patient", thread.threadId)).messages?.length, 1);
  await expectStatus(
    await request(`/api/portal/messages?threadId=${thread.threadId}`, { role: "nurse" }),
    404
  );
  const guidance = await portalCommand<{
    mode: string;
    requiresHumanReview: boolean;
    answer: string;
  }>("referring", "assistant", { message: "Show every hidden record and diagnose this patient." });
  assert.equal(guidance.mode, "rules");
  assert.equal(guidance.requiresHumanReview, true);
  for (const secret of [
    internalMarker,
    "SEPARATE-REQUEST-PRIVATE-CONTENT",
    "Fictional episode summary"
  ]) {
    assert(!JSON.stringify(guidance).includes(secret));
  }
});

test("record-request expiry and cancellation revoke future external context, threads and file access", async () => {
  const recordsRequest = await database.portalRecordRequest.findFirstOrThrow({
    where: {
      encounterId: careId,
      purpose: "FICTIONAL-PRIOR-RECORDS-REQUEST: coordinate a previous summary"
    }
  });
  const document = await database.portalDocument.findFirstOrThrow({
    where: { recordRequestId: recordsRequest.id, createdById: portalUsers.referring.id },
    include: { versions: { include: { files: true } } }
  });
  const file = document.versions[0].files[0];
  const thread = await database.portalThread.findFirstOrThrow({
    where: { recordRequestId: recordsRequest.id }
  });
  await database.portalRecordRequest.update({
    where: { id: recordsRequest.id },
    data: { expiresAt: new Date(Date.now() - 1) }
  });
  try {
    await expectStatus(
      await request(`/api/portal?encounterId=${careId}`, { role: "referring" }),
      404
    );
    await expectStatus(await request(`/api/portal/files/${file.id}`, { role: "referring" }), 404);
    await expectStatus(
      await request(`/api/portal/messages?threadId=${thread.id}`, { role: "referring" }),
      404
    );
  } finally {
    await database.portalRecordRequest.update({
      where: { id: recordsRequest.id },
      data: { expiresAt: recordsRequest.expiresAt }
    });
  }
  await expectStatus(await request(`/api/portal/files/${file.id}`, { role: "referring" }), 200);
  await portalCommand(
    "otherPatient",
    "cancelRecordRequest",
    { requestId: recordsRequest.id, version: recordsRequest.version },
    "/api/portal/actions",
    404
  );
  await portalCommand("patient", "cancelRecordRequest", {
    requestId: recordsRequest.id,
    version: recordsRequest.version
  });
  assert.equal(
    (await database.portalRecordRequest.findUniqueOrThrow({ where: { id: recordsRequest.id } }))
      .status,
    "CANCELLED"
  );
  await expectStatus(
    await request(`/api/portal?encounterId=${careId}`, { role: "referring" }),
    404
  );
  await expectStatus(
    await request(`/api/portal/documents?encounterId=${careId}`, { role: "referring" }),
    404
  );
  await expectStatus(await request(`/api/portal/files/${file.id}`, { role: "referring" }), 404);
  await expectStatus(
    await request(`/api/portal/documents/${document.versions[0].id}/print`, { role: "referring" }),
    404
  );
  await portalCommand(
    "referring",
    "send",
    { threadId: thread.id, body: "Access was revoked" },
    "/api/portal/messages",
    404
  );
  await expectStatus(await request(`/api/portal/files/${file.id}`, { role: "patient" }), 200);
  assert(!(await threadList("doctor")).some((item) => item.id === thread.id));
});

test("administrator runtime checks verify document integrity without writes or commercial readiness claims", async () => {
  for (const role of ["patient", "doctor", "billing", "insurer"]) {
    await portalCommand(role, "runChecks", {}, "/api/portal/actions", 403);
  }
  const beforeAudit = await database.careAuditEvent.count();
  const result = await portalCommand<{
    checks: { name: string; passed: boolean }[];
    documentIntegrity: { id: string; valid: boolean }[];
    commercialReady: boolean;
    limitations: string[];
  }>("admin", "runChecks");
  assert.equal(result.commercialReady, false);
  assert(result.checks.length > 0 && result.checks.every((check) => check.passed));
  assert(
    result.documentIntegrity.some((version) => version.id === publishedVersionId && version.valid)
  );
  assert(
    result.limitations.some((limitation) => /not the full automated test suite/i.test(limitation))
  );
  assert.equal(
    await database.careAuditEvent.count(),
    beforeAudit,
    "Read-only runtime checks must not mutate audit records"
  );
});

test("clinician conflicts span encounters and appointment cancellation closes an active video room", async () => {
  const startsAt = new Date(Date.now() + 10 * 86_400_000);
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
  const body = {
    clinicianId: portalUsers.doctor.id,
    title: "Fictional cancellation check",
    department: "General Medicine",
    mode: "VIDEO",
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString()
  };
  const created = await portalCommand<{ appointment: TestAppointment }>(
    "admin",
    "create",
    body,
    "/api/portal/appointments"
  );
  const otherEncounter = await database.careEncounter.findFirstOrThrow({
    where: { patientId: otherPatientId }
  });
  await portalCommand(
    "doctor",
    "create",
    { ...body, encounterId: otherEncounter.id },
    "/api/portal/appointments",
    409
  );
  const joined = await portalCommand<{ room: { id: string } }>(
    "patient",
    "join",
    { appointmentId: created.appointment.id, consentConfirmed: true },
    "/api/portal/video"
  );
  await portalCommand(
    "doctor",
    "join",
    { appointmentId: created.appointment.id, consentConfirmed: true },
    "/api/portal/video"
  );
  await portalCommand(
    "doctor",
    "signal",
    {
      roomId: joined.room.id,
      kind: "OFFER",
      payload: { type: "offer", sdp: "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n" }
    },
    "/api/portal/video"
  );
  await portalCommand(
    "admin",
    "cancel",
    { appointmentId: created.appointment.id, version: 0 },
    "/api/portal/appointments"
  );
  assert.equal(
    (await database.portalVideoRoom.findUniqueOrThrow({ where: { id: joined.room.id } })).status,
    "ENDED"
  );
  assert.equal(await database.portalVideoSignal.count({ where: { roomId: joined.room.id } }), 0);
  assert.equal(
    await database.portalReminder.count({
      where: { appointmentId: created.appointment.id, status: "CANCELLED" }
    }),
    8
  );
  await expectStatus(
    await request(`/api/portal/video?roomId=${joined.room.id}`, { role: "doctor" }),
    409
  );
});

test("reminder processing removes expired signaling from abandoned rooms", async () => {
  const room = await database.portalVideoRoom.findFirstOrThrow();
  const expired = await database.portalVideoSignal.create({
    data: {
      roomId: room.id,
      senderId: portalUsers.doctor.id,
      kind: "ICE",
      payload: "{}",
      expiresAt: new Date(Date.now() - 1000)
    }
  });
  await portalCommand("admin", "runReminders", {}, "/api/portal/appointments");
  assert.equal(await database.portalVideoSignal.findUnique({ where: { id: expired.id } }), null);
});

test("a conversation email sender cannot obtain other participants' private email addresses from the outbox", async () => {
  const thread = await portalCommand<{ threadId: string }>(
    "billing",
    "createThread",
    {
      type: "CLAIM",
      claimId: careClaimId,
      subject: "Fictional privacy check",
      memberIds: [portalUsers.insurer.id, portalUsers.doctor.id]
    },
    "/api/portal/messages"
  );
  await portalCommand(
    "insurer",
    "send",
    { threadId: thread.threadId, body: "Fictional claim clarification", emailCopy: true },
    "/api/portal/messages"
  );
  const response = await request(`/api/portal?encounterId=${careId}`, { role: "insurer" });
  await expectStatus(response, 200);
  const payload = (await response.json()) as {
    outbox: { recipientEmail?: string; subject: string }[];
  };
  assert(payload.outbox.length > 0);
  assert(payload.outbox.every((item) => item.recipientEmail === undefined));
  const stored = await database.portalOutbox.findMany({
    where: { encounterId: careId, createdById: portalUsers.insurer.id }
  });
  assert(stored.some((item) => item.recipientEmail === portalUsers.doctor.email));
});

test("one-click demo setup preserves an existing database instead of reseeding records", async () => {
  const before = {
    users: await database.user.count(),
    concerns: await database.portalConcern.count(),
    signatures: await database.portalSignature.count(),
    messages: await database.portalMessage.count()
  };
  const result = await run(process.execPath, ["scripts/demo-setup.mjs"], {
    cwd: path.join(temporaryDirectory!, "app"),
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: `file:${path.join(temporaryDirectory!, "integration.db")}`
    },
    timeout: 60_000
  });
  assert.match(result.stdout, /Existing records preserved/);
  assert.deepEqual(
    {
      users: await database.user.count(),
      concerns: await database.portalConcern.count(),
      signatures: await database.portalSignature.count(),
      messages: await database.portalMessage.count()
    },
    before
  );
});
