import { NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAuthSession } from "@/lib/auth";
import { audit, CareError, errorResponse, jsonObject, text, optionalText, requireRole } from "@/lib/care-access";
import type { Actor } from "@/lib/care-access";

const reply = (data: object) => NextResponse.json(data, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function scope(actor: Actor) {
  return actor.role === "patient" ? { patient: { userId: actor.id } } : { doctorId: actor.id };
}
function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && origin !== process.env.REMOTE_APP_ORIGIN)
    throw new CareError(403, "Origin not permitted.");
}
export async function GET() {
  try {
    const { user } = await requireAuthSession();
    requireRole(user, ["patient", "doctor", "admin"]);
    if (user.role === "admin") return reply({ patients: await prisma.patientProfile.findMany({
      select: { id: true, fullName: true, facilityFileNumber: true }, orderBy: { fullName: "asc" }, take: 200
    }), consultations: [] });
    const profile = user.role === "patient" ? await prisma.patientProfile.findUnique({
      where: { userId: user.id }, select: { fullName: true, phone: true, medicalAidScheme: true, medicalAidPlan: true, nextOfKin: true, nextOfKinPhone: true, popiaConsent: true, consentTreatment: true }
    }) : null;
    const doctors = user.role === "patient" ? await prisma.user.findMany({
      where: { role: "doctor" }, select: { id: true, name: true, unit: true }
    }) : [];
    const consultations = await prisma.remoteConsultation.findMany({
      where: scope(user), orderBy: { createdAt: "desc" }, take: 50,
      include: { patient: { select: { fullName: true, popiaConsent: true, consentTreatment: true } }, doctor: { select: { name: true, unit: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 100 } }
    });
    // SDP may contain network addresses: never disclose to admissions or unrelated users.
    const safe = consultations.map(c => ({
      ...c, offer: c.status === "ACCEPTED" && c.patient.popiaConsent && c.patient.consentTreatment ? c.offer : "",
      answer: c.status === "ACCEPTED" && c.patient.popiaConsent && c.patient.consentTreatment ? c.answer : "",
      messages: c.messages.reverse()
    }));
    let iceServers: unknown = [];
    try { iceServers = JSON.parse(process.env.REMOTE_ICE_SERVERS || "[]"); } catch { /* no external service by default */ }
    const phone = process.env.REMOTE_DEMO_PHONE || "";
    return reply({ profile, doctors, consultations: safe, iceServers, phone: /^\+[1-9]\d{7,14}$/.test(phone) ? phone : "" });
  } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = jsonObject(await request.json());
    const action = text(body.action, "Action", 30);
    if (action === "activate") {
      const code = text(body.code, "Invitation code", 64);
      const password = typeof body.password === "string" ? body.password : "";
      if (!/^[a-f0-9]{48}$/.test(code) || password.length < 12 || Buffer.byteLength(password) > 72)
        throw new CareError(400, "Enter a valid invitation and a password of at least 12 characters (72 bytes maximum).");
      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.$transaction(async tx => {
        const invite = await tx.patientInvitation.findUnique({ where: { tokenHash: hash(code) }, include: { patient: true } });
        if (!invite || invite.usedAt || invite.expiresAt <= new Date()) throw new CareError(400, "Invalid or expired invitation.");
        const used = await tx.patientInvitation.updateMany({ where: { id: invite.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
        if (used.count !== 1) throw new CareError(409, "Invitation already used.");
        await tx.user.update({ where: { id: invite.patient.userId }, data: { passwordHash } });
        await tx.session.deleteMany({ where: { userId: invite.patient.userId } });
        await tx.patientInvitation.updateMany({ where: { patientId: invite.patientId, usedAt: null }, data: { usedAt: new Date() } });
        await audit(tx, { id: invite.patient.userId, name: invite.patient.fullName, email: invite.patient.email, role: "patient", unit: "Admissions" }, null, "PATIENT_ACCOUNT_ACTIVATED", invite.patientId);
      });
      return reply({ ok: true });
    }
    const { user } = await requireAuthSession();
    if (action === "invite") {
      requireRole(user, ["admin"]);
      const patientId = text(body.patientId, "Patient", 100);
      const code = randomBytes(24).toString("hex");
      await prisma.$transaction(async tx => {
        const patient = await tx.patientProfile.findUnique({ where: { id: patientId } });
        if (!patient) throw new CareError(404, "Patient not found.");
        await tx.patientInvitation.updateMany({ where: { patientId, usedAt: null }, data: { usedAt: new Date() } });
        await tx.patientInvitation.create({ data: { patientId, tokenHash: hash(code), expiresAt: new Date(Date.now() + 30 * 60_000) } });
        await audit(tx, user, null, "PATIENT_INVITED", patientId);
      });
      return reply({ code });
    }
    requireRole(user, ["patient", "doctor"]);
    if (action === "onboard") {
      requireRole(user, ["patient"]);
      if (typeof body.popiaConsent !== "boolean" || typeof body.consentTreatment !== "boolean") throw new CareError(400, "Record both consent choices.");
      const phone = text(body.phone, "Phone", 40);
      if (!/^\+?[0-9 ()-]{7,25}$/.test(phone)) throw new CareError(400, "Enter a valid phone number.");
      await prisma.$transaction(async tx => {
        const patient = await tx.patientProfile.update({ where: { userId: user.id }, data: {
          phone, medicalAidScheme: text(body.medicalAidScheme, "Funding", 160),
          medicalAidPlan: optionalText(body.medicalAidPlan, "Plan", 160), nextOfKin: optionalText(body.nextOfKin, "Emergency contact", 160),
          nextOfKinPhone: optionalText(body.nextOfKinPhone, "Emergency contact phone", 40),
          popiaConsent: body.popiaConsent as boolean, consentTreatment: body.consentTreatment as boolean
        } });
        if (!patient.popiaConsent || !patient.consentTreatment) await tx.remoteConsultation.updateMany({ where: { patientId: patient.id, status: { in: ["REQUESTED", "ACCEPTED"] } }, data: { status: "CANCELLED", offer: "", answer: "" } });
        await audit(tx, user, null, "REMOTE_ONBOARDING_UPDATED", patient.id);
      });
      return reply({ ok: true });
    }
    if (action === "book") {
      requireRole(user, ["patient"]);
      const doctorId = text(body.doctorId, "Doctor", 100), mode = text(body.mode, "Mode", 20);
      if (!["VIDEO", "AUDIO", "PHONE", "CHAT", "IN_PERSON"].includes(mode)) throw new CareError(400, "Choose a consultation type.");
      const scheduledAt = new Date(text(body.scheduledAt, "Appointment time", 60));
      if (!Number.isFinite(+scheduledAt) || +scheduledAt < Date.now() - 60_000 || +scheduledAt > Date.now() + 90 * 86400_000) throw new CareError(400, "Choose a future appointment within 90 days.");
      const reason = text(body.reason, "Reason", 500);
      const consultation = await prisma.$transaction(async tx => {
        const patient = await tx.patientProfile.findUnique({ where: { userId: user.id } });
        if (!patient?.popiaConsent || !patient.consentTreatment) throw new CareError(403, "Complete onboarding and record consent first.");
        if (!await tx.user.findFirst({ where: { id: doctorId, role: "doctor" } })) throw new CareError(400, "Choose a doctor.");
        const row = await tx.remoteConsultation.create({ data: { patientId: patient.id, doctorId, mode, reason, scheduledAt } });
        await audit(tx, user, null, "REMOTE_BOOKED", row.id);
        return row;
      });
      return reply({ id: consultation.id });
    }
    const id = text(body.id, "Consultation", 100);
    await prisma.$transaction(async tx => {
      const c = await tx.remoteConsultation.findFirst({ where: { id, ...scope(user) }, include: { patient: true } });
      if (!c) throw new CareError(404, "Consultation not found.");
      if (action === "accept" || action === "cancel" || action === "complete") {
        if (action !== "cancel") requireRole(user, ["doctor"]);
        if (action === "accept" && (!c.patient.popiaConsent || !c.patient.consentTreatment)) throw new CareError(403, "Patient consent required.");
        const allowed = action === "accept" ? ["REQUESTED"] : action === "complete" ? ["ACCEPTED"] : ["REQUESTED","ACCEPTED"];
        if (!allowed.includes(c.status)) throw new CareError(409, "Consultation is not in the required state.");
        const status = action === "accept" ? "ACCEPTED" : action === "complete" ? "COMPLETED" : "CANCELLED";
        const changed = await tx.remoteConsultation.updateMany({ where: { id, status: c.status }, data: { status, ...(action === "accept" ? {} : { offer: "", answer: "" }) } });
        if (changed.count !== 1) throw new CareError(409, "Refresh and retry.");
      } else {
        if (c.status !== "ACCEPTED" || !c.patient.popiaConsent || !c.patient.consentTreatment) throw new CareError(409, "An accepted, consented consultation is required.");
        if (action === "message") {
          await tx.remoteMessage.create({ data: { consultationId: id, authorId: user.id, authorName: user.name, body: text(body.body, "Message", 2000) } });
        } else if (["offer", "answer", "hangup"].includes(action)) {
          if (!["VIDEO","AUDIO"].includes(c.mode)) throw new CareError(400, "This is not a browser call.");
          if (action === "hangup") await tx.remoteConsultation.update({ where: { id }, data: { offer: "", answer: "" } });
          else {
            requireRole(user, action === "offer" ? ["patient"] : ["doctor"]);
            const sdp = typeof body.sdp === "string" ? body.sdp : "";
            if (sdp.length > 65000 || !sdp.startsWith("v=0")) throw new CareError(400, "Invalid session description.");
            if (action === "offer" && c.offer) throw new CareError(409, "End the existing call before restarting.");
            if (action === "answer" && (!c.offer || c.answer)) throw new CareError(409, "No unanswered call.");
            await tx.remoteConsultation.update({ where: { id }, data: action === "offer" ? { offer: sdp, answer: "" } : { answer: sdp } });
          }
        } else if (action === "dial") {
          if (c.mode !== "PHONE" || !/^\+[1-9]\d{7,14}$/.test(process.env.REMOTE_DEMO_PHONE || "")) throw new CareError(409, "No demo telephone destination configured.");
        } else throw new CareError(400, "Unknown action.");
      }
      await audit(tx, user, null, "REMOTE_" + action.toUpperCase(), id);
    });
    return reply({ ok: true });
  } catch (e) { return errorResponse(e); }
}
