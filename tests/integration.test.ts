import assert from "node:assert/strict";
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
    for (const role of ["paramedic", "paramedic2", "billing", "insurer", "insurer2"]) {
      await login(role, `${role}@ubuntucare.demo`);
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
