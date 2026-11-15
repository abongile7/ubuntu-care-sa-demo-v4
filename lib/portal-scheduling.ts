import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  Actor,
  CareError,
  audit,
  jsonObject,
  optionalText,
  ref,
  requireRole,
  text,
  versionNumber
} from "@/lib/care-access";
import { requirePortalEncounter } from "@/lib/portal-access";

type Database = Prisma.TransactionClient;
const STAFF = ["admin", "doctor", "nurse"] as const;
const SCHEDULING = ["patient", ...STAFF] as const;
const SIGNAL_TTL_MS = 120_000;
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export { privateHeaders as schedulingHeaders };

function dateWithOffset(value: unknown, label: string) {
  const raw = text(value, label, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    throw new CareError(400, `${label} must include an explicit UTC offset, for example +02:00.`);
  }
  const valueDate = new Date(raw);
  if (!Number.isFinite(valueDate.getTime())) throw new CareError(400, `${label} is invalid.`);
  // Date parsing otherwise silently normalises dates such as 31 February.
  const datePart = raw.slice(0, 10);
  const [year, month, day] = datePart.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.toISOString().slice(0, 10) !== datePart)
    throw new CareError(400, `${label} is invalid.`);
  return valueDate;
}

async function scopedAppointment(actor: Actor, appointmentId: string, tx: Database = prisma) {
  requireRole(actor, SCHEDULING);
  const appointment = await tx.portalAppointment.findUnique({
    where: { id: appointmentId },
    include: { videoRoom: true }
  });
  if (!appointment) throw new CareError(404, "Appointment not found.");
  const encounter = await requirePortalEncounter(actor, appointment.encounterId, tx);
  return { appointment, encounter };
}

async function checkConflict(
  tx: Database,
  clinicianId: string,
  startsAt: Date,
  endsAt: Date,
  excludeId?: string
) {
  const conflict = await tx.portalAppointment.findFirst({
    where: {
      clinicianId,
      status: "CONFIRMED",
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(excludeId ? { id: { not: excludeId } } : {})
    }
  });
  if (conflict)
    throw new CareError(
      409,
      "This clinician already has a confirmed appointment during that time."
    );
}

async function createReminders(
  tx: Database,
  appointment: { id: string; encounterId: string; clinicianId: string; startsAt: Date },
  patientUserId: string
) {
  for (const userId of new Set([patientUserId, appointment.clinicianId])) {
    for (const hours of [24, 1]) {
      for (const channel of ["IN_APP", "EMAIL"]) {
        const dedupeKey = `appointment:${appointment.id}:${hours}h:${channel}:${userId}`;
        await tx.portalReminder.upsert({
          where: { dedupeKey },
          update: {},
          create: {
            appointmentId: appointment.id,
            encounterId: appointment.encounterId,
            userId,
            channel,
            dueAt: new Date(appointment.startsAt.getTime() - hours * 3_600_000),
            dedupeKey
          }
        });
      }
    }
  }
}

export async function listAppointments(actor: Actor, encounterId: string) {
  requireRole(actor, SCHEDULING);
  await requirePortalEncounter(actor, encounterId);
  const [appointments, clinicians, reminders] = await Promise.all([
    prisma.portalAppointment.findMany({
      where: { encounterId },
      orderBy: { startsAt: "asc" },
      include: { videoRoom: { select: { id: true, status: true } } }
    }),
    prisma.user.findMany({
      where: { role: { in: ["doctor", "nurse"] } },
      select: { id: true, name: true, role: true, unit: true },
      orderBy: { name: "asc" }
    }),
    prisma.portalReminder.findMany({
      where: { encounterId, userId: actor.id },
      orderBy: { dueAt: "asc" },
      select: {
        id: true,
        appointmentId: true,
        channel: true,
        dueAt: true,
        status: true,
        deliveredAt: true
      }
    })
  ]);
  return {
    appointments: appointments.map((appointment) => ({
      ...appointment,
      clinician: clinicians.find((clinician) => clinician.id === appointment.clinicianId) ?? null
    })),
    clinicians,
    reminders
  };
}

export async function mutateAppointment(actor: Actor, input: Record<string, unknown>) {
  const action = text(input.action, "Action", 30);
  if (action === "runReminders") return processDueReminders(actor);
  requireRole(actor, SCHEDULING);
  if (action === "create") {
    const encounterId = text(input.encounterId, "Encounter", 100);
    const clinicianId = text(input.clinicianId, "Clinician", 100);
    const title = text(input.title, "Appointment title", 160);
    // API accepts bounded ward-specific names; the booking UI uses the facility catalogue.
    const department = text(input.department, "Department", 80);
    const patientInstructions = optionalText(
      input.patientInstructions,
      "Patient instructions",
      2000
    );
    const startsAt = dateWithOffset(input.startsAt, "Start time");
    const endsAt = dateWithOffset(input.endsAt, "End time");
    if (
      startsAt.getTime() <= Date.now() ||
      endsAt <= startsAt ||
      endsAt.getTime() - startsAt.getTime() > 4 * 3_600_000
    ) {
      throw new CareError(
        400,
        "Choose a future appointment lasting more than zero and at most four hours."
      );
    }
    if (input.mode !== "ONSITE" && input.mode !== "VIDEO")
      throw new CareError(400, "Choose ONSITE or VIDEO.");
    const mode = input.mode;
    return prisma.$transaction(async (tx) => {
      const encounter = await requirePortalEncounter(actor, encounterId, tx);
      const clinician = await tx.user.findFirst({
        where: { id: clinicianId, role: { in: ["doctor", "nurse"] } },
        select: { id: true }
      });
      if (!clinician) throw new CareError(400, "Choose a hospital doctor or nurse.");
      const status = actor.role === "patient" ? "REQUESTED" : "CONFIRMED";
      if (status === "CONFIRMED") await checkConflict(tx, clinicianId, startsAt, endsAt);
      const appointment = await tx.portalAppointment.create({
        data: {
          reference: ref("APT"),
          encounterId,
          clinicianId,
          title,
          department,
          patientInstructions,
          startsAt,
          endsAt,
          mode,
          status,
          createdById: actor.id
        }
      });
      if (status === "CONFIRMED") await createReminders(tx, appointment, encounter.patient.userId);
      await audit(
        tx,
        actor,
        encounterId,
        "PORTAL_APPOINTMENT_CREATED",
        `${appointment.reference}; ${status}; ${mode}`
      );
      return { appointment };
    });
  }
  if (action !== "confirm" && action !== "cancel")
    throw new CareError(400, "Unknown appointment action.");
  const appointmentId = text(input.appointmentId, "Appointment", 100);
  const version = versionNumber(input.version);
  return prisma.$transaction(async (tx) => {
    const { appointment, encounter } = await scopedAppointment(actor, appointmentId, tx);
    if (action === "confirm") requireRole(actor, STAFF);
    if (appointment.version !== version)
      throw new CareError(409, "This appointment changed. Refresh and try again.");
    if (action === "confirm" && appointment.status !== "REQUESTED")
      throw new CareError(409, "Only requested appointments can be confirmed.");
    if (action === "cancel" && !["REQUESTED", "CONFIRMED"].includes(appointment.status))
      throw new CareError(409, "This appointment cannot be cancelled.");
    if (appointment.startsAt.getTime() <= Date.now())
      throw new CareError(409, "Historical appointments cannot be changed here.");
    if (action === "confirm") {
      if (appointment.videoRoom?.status === "ENDED")
        throw new CareError(409, "An ended video appointment cannot be reopened.");
      await checkConflict(
        tx,
        appointment.clinicianId,
        appointment.startsAt,
        appointment.endsAt,
        appointment.id
      );
    }
    const status = action === "confirm" ? "CONFIRMED" : "CANCELLED";
    const result = await tx.portalAppointment.updateMany({
      where: { id: appointmentId, version },
      data: { status, version: { increment: 1 } }
    });
    if (result.count !== 1)
      throw new CareError(409, "This appointment changed. Refresh and try again.");
    if (action === "confirm") await createReminders(tx, appointment, encounter.patient.userId);
    else {
      await tx.portalReminder.updateMany({
        where: { appointmentId, status: "PENDING" },
        data: { status: "CANCELLED" }
      });
      if (appointment.videoRoom && appointment.videoRoom.status !== "ENDED") {
        await tx.portalVideoSignal.deleteMany({ where: { roomId: appointment.videoRoom.id } });
        await tx.portalVideoRoom.update({
          where: { id: appointment.videoRoom.id },
          data: { status: "ENDED", endedAt: new Date() }
        });
        await audit(
          tx,
          actor,
          appointment.encounterId,
          "PORTAL_VIDEO_ENDED",
          `Appointment ${appointment.reference} cancelled`
        );
      }
    }
    await audit(
      tx,
      actor,
      appointment.encounterId,
      `PORTAL_APPOINTMENT_${status}`,
      appointment.reference
    );
    return { appointment: await tx.portalAppointment.findUnique({ where: { id: appointmentId } }) };
  });
}

/** Persistent and idempotent. EMAIL entries are simulated outbox records only. */
export async function processDueReminders(actor?: Actor) {
  if (actor) requireRole(actor, ["admin"]);
  // The watch worker also removes expired signaling from abandoned rooms.
  await prisma.portalVideoSignal.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  const due = await prisma.portalReminder.findMany({
    where: { status: "PENDING", dueAt: { lte: new Date() } },
    orderBy: { dueAt: "asc" },
    take: 200,
    select: { id: true }
  });
  let processed = 0,
    notifications = 0,
    emails = 0;
  for (const item of due) {
    const result = await prisma.$transaction(async (tx) => {
      const reminder = await tx.portalReminder.findUnique({
        where: { id: item.id },
        include: { appointment: true }
      });
      if (!reminder || reminder.status !== "PENDING") return null;
      const claimed = await tx.portalReminder.updateMany({
        where: { id: item.id, status: "PENDING" },
        data: { status: "PROCESSING" }
      });
      if (claimed.count !== 1) return null;
      if (reminder.appointmentId && reminder.appointment?.status !== "CONFIRMED") {
        await tx.portalReminder.update({ where: { id: item.id }, data: { status: "CANCELLED" } });
        return null;
      }
      const user = await tx.user.findUnique({
        where: { id: reminder.userId },
        select: { email: true }
      });
      if (!user) {
        await tx.portalReminder.update({ where: { id: item.id }, data: { status: "CANCELLED" } });
        return null;
      }
      const dedupeKey = `reminder:${reminder.id}`;
      if (reminder.channel === "IN_APP") {
        await tx.portalNotification.upsert({
          where: { dedupeKey },
          update: {},
          create: {
            encounterId: reminder.encounterId,
            userId: reminder.userId,
            title: "Appointment reminder",
            body: "You have an upcoming hospital appointment. Sign in to view the details.",
            kind: "APPOINTMENT",
            link: "/connect",
            dedupeKey
          }
        });
      } else if (reminder.channel === "EMAIL") {
        await tx.portalOutbox.upsert({
          where: { dedupeKey },
          update: {},
          create: {
            encounterId: reminder.encounterId,
            recipientUserId: reminder.userId,
            recipientEmail: user.email,
            subject: "Hospital appointment reminder",
            body: "You have an upcoming hospital appointment. Sign in to the hospital portal for details. This demo email is simulated and is not sent.",
            category: "APPOINTMENT_REMINDER",
            status: "QUEUED_SIMULATED",
            dedupeKey,
            createdById: actor?.id ?? "reminder-worker"
          }
        });
      } else throw new CareError(400, "Unsupported reminder channel.");
      await tx.portalReminder.update({
        where: { id: item.id },
        data: { status: "DELIVERED", deliveredAt: new Date() }
      });
      return reminder.channel;
    });
    if (result) {
      processed++;
      if (result === "IN_APP") notifications++;
      else emails++;
    }
  }
  return { processed, notifications, emails, emailDelivery: "SIMULATED_ONLY" };
}

const icsEscape = (value: string) =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;")
    .replaceAll("\r", "");
const icsDate = (value: Date) =>
  value
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
export async function appointmentCalendar(actor: Actor, appointmentId: string) {
  const { appointment } = await scopedAppointment(actor, appointmentId);
  // Deliberately generic: exported calendars must not include clinical detail.
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ubuntu Care//Fictional hospital demo//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${appointment.id}@ubuntucare.demo`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(appointment.startsAt)}`,
    `DTEND:${icsDate(appointment.endsAt)}`,
    "SUMMARY:Hospital appointment",
    `DESCRIPTION:${icsEscape("View appointment details in the hospital portal. Times are exported in UTC; South Africa is UTC+02:00.")}`,
    `STATUS:${appointment.status === "CANCELLED" ? "CANCELLED" : appointment.status === "CONFIRMED" ? "CONFIRMED" : "TENTATIVE"}`,
    "END:VEVENT",
    "END:VCALENDAR",
    ""
  ].join("\r\n");
}

async function videoGrant(actor: Actor, appointmentId: string, tx: Database) {
  const appointment = await tx.portalAppointment.findUnique({
    where: { id: appointmentId },
    include: { encounter: { include: { patient: true } }, videoRoom: true }
  });
  if (
    !appointment ||
    (actor.id !== appointment.clinicianId && actor.id !== appointment.encounter.patient.userId)
  )
    throw new CareError(404, "Video appointment not found.");
  if (appointment.mode !== "VIDEO" || appointment.status !== "CONFIRMED")
    throw new CareError(409, "Video requires a confirmed video appointment.");
  if (
    !appointment.encounter.patient.popiaConsent ||
    !appointment.encounter.patient.consentTreatment
  )
    throw new CareError(
      403,
      "Recorded patient privacy and treatment consent are required before video."
    );
  return appointment;
}

async function joinedRoom(actor: Actor, roomId: string, tx: Database) {
  const room = await tx.portalVideoRoom.findUnique({ where: { id: roomId } });
  if (!room) throw new CareError(404, "Video room not found.");
  const appointment = await videoGrant(actor, room.appointmentId, tx);
  const membership = await tx.portalVideoParticipant.findUnique({
    where: { roomId_userId: { roomId, userId: actor.id } }
  });
  if (!membership?.consentRecordedAt)
    throw new CareError(403, "Join with informed consent before accessing this call.");
  if (room.status === "ENDED")
    throw new CareError(409, "This call has ended. Book a new video appointment to call again.");
  return { room, appointment };
}

function validateSignal(kind: unknown, value: unknown) {
  if (kind !== "OFFER" && kind !== "ANSWER" && kind !== "ICE")
    throw new CareError(400, "Unsupported signal kind.");
  const payload = jsonObject(value);
  if (kind === "ICE") {
    const candidate = text(payload.candidate, "ICE candidate", 2048);
    if (
      !/^candidate:[^\r\n]+$/.test(candidate) ||
      (payload.sdpMid !== null && typeof payload.sdpMid !== "string") ||
      (typeof payload.sdpMid === "string" && payload.sdpMid.length > 64) ||
      (payload.sdpMLineIndex !== null &&
        (!Number.isInteger(payload.sdpMLineIndex) ||
          Number(payload.sdpMLineIndex) < 0 ||
          Number(payload.sdpMLineIndex) > 32))
    ) {
      throw new CareError(400, "Invalid ICE candidate.");
    }
    return JSON.stringify({
      candidate,
      sdpMid: payload.sdpMid,
      sdpMLineIndex: payload.sdpMLineIndex
    });
  }
  const expected = kind === "OFFER" ? "offer" : "answer";
  if (
    payload.type !== expected ||
    typeof payload.sdp !== "string" ||
    payload.sdp.length > 100_000 ||
    !payload.sdp.startsWith("v=0") ||
    !payload.sdp.includes("m=")
  ) {
    throw new CareError(400, "Invalid session description.");
  }
  return JSON.stringify({ type: expected, sdp: payload.sdp });
}

export async function getVideoSignals(actor: Actor, roomId: string) {
  return prisma.$transaction(async (tx) => {
    const { room, appointment } = await joinedRoom(actor, roomId, tx);
    await tx.portalVideoSignal.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    const [signals, participants] = await Promise.all([
      tx.portalVideoSignal.findMany({
        where: { roomId, senderId: { not: actor.id }, expiresAt: { gt: new Date() } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 200,
        select: { id: true, kind: true, payload: true, createdAt: true }
      }),
      tx.portalVideoParticipant.findMany({ where: { roomId }, select: { userId: true } })
    ]);
    return {
      room: { id: room.id, status: room.status },
      participants: participants.length,
      isOfferer: actor.id === appointment.clinicianId,
      signals: signals.map((signal) => ({ ...signal, payload: JSON.parse(signal.payload) }))
    };
  });
}

export async function mutateVideo(actor: Actor, input: Record<string, unknown>) {
  const action = text(input.action, "Action", 20);
  if (action === "join") {
    const appointmentId = text(input.appointmentId, "Appointment", 100);
    if (input.consentConfirmed !== true)
      throw new CareError(
        400,
        "Confirm informed consent to camera and microphone use. Calls are not recorded."
      );
    return prisma.$transaction(async (tx) => {
      const appointment = await videoGrant(actor, appointmentId, tx);
      if (appointment.videoRoom?.status === "ENDED")
        throw new CareError(
          409,
          "This call has ended. Book a new video appointment to call again."
        );
      const room =
        appointment.videoRoom ?? (await tx.portalVideoRoom.create({ data: { appointmentId } }));
      await tx.portalVideoParticipant.upsert({
        where: { roomId_userId: { roomId: room.id, userId: actor.id } },
        update: {},
        create: { roomId: room.id, userId: actor.id, consentRecordedAt: new Date() }
      });
      const participants = await tx.portalVideoParticipant.count({ where: { roomId: room.id } });
      if (participants === 2 && room.status === "WAITING") {
        await tx.portalVideoRoom.update({
          where: { id: room.id },
          data: { status: "ACTIVE", startedAt: new Date() }
        });
        await audit(
          tx,
          actor,
          appointment.encounterId,
          "PORTAL_VIDEO_STARTED",
          appointment.reference
        );
      }
      return {
        room: { id: room.id, status: participants === 2 ? "ACTIVE" : "WAITING" },
        isOfferer: actor.id === appointment.clinicianId,
        participants
      };
    });
  }
  if (action !== "signal" && action !== "leave") throw new CareError(400, "Unknown video action.");
  const roomId = text(input.roomId, "Video room", 100);
  return prisma.$transaction(async (tx) => {
    const { room, appointment } = await joinedRoom(actor, roomId, tx);
    if (action === "leave") {
      await tx.portalVideoSignal.deleteMany({ where: { roomId } });
      await tx.portalVideoRoom.update({
        where: { id: roomId },
        data: { status: "ENDED", endedAt: new Date() }
      });
      await audit(tx, actor, appointment.encounterId, "PORTAL_VIDEO_ENDED", appointment.reference);
      return { room: { id: room.id, status: "ENDED" } };
    }
    if (
      (input.kind === "OFFER" && actor.id !== appointment.clinicianId) ||
      (input.kind === "ANSWER" && actor.id === appointment.clinicianId)
    )
      throw new CareError(403, "Only the assigned clinician offers and the patient answers.");
    const payload = validateSignal(input.kind, input.payload);
    await tx.portalVideoSignal.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    const signalCount = await tx.portalVideoSignal.count({ where: { roomId } });
    if (signalCount >= 200)
      throw new CareError(429, "Signaling limit reached. Wait for old signals to expire.");
    if (
      input.kind !== "ICE" &&
      (await tx.portalVideoSignal.findFirst({
        where: { roomId, senderId: actor.id, kind: input.kind as string }
      }))
    )
      throw new CareError(409, "A session description was already submitted for this call.");
    const signal = await tx.portalVideoSignal.create({
      data: {
        roomId,
        senderId: actor.id,
        kind: input.kind as string,
        payload,
        expiresAt: new Date(Date.now() + SIGNAL_TTL_MS)
      }
    });
    return { signalId: signal.id };
  });
}
