import type {
  Appointment,
  ArrivalRecord,
  DocumentRecord,
  EmailLog,
  LabResult,
  MedicationAdministration,
  MedicationOrder,
  MessageRecord,
  PatientProfile,
  ScanRecord,
  ShiftTask,
  TheatreCase,
  TransferRecord,
  VitalRecord
} from "@prisma/client";

export function serializePatient(patient: PatientProfile) {
  return {
    ...patient,
    dateOfBirth: patient.dateOfBirth.toISOString().slice(0, 10),
    createdAt: patient.createdAt.toISOString(),
    updatedAt: patient.updatedAt.toISOString()
  };
}

export function serializeAppointment(appointment: Appointment) {
  return {
    ...appointment,
    scheduledAt: appointment.scheduledAt.toISOString(),
    createdAt: appointment.createdAt.toISOString(),
    updatedAt: appointment.updatedAt.toISOString()
  };
}

export function serializeScan(scan: ScanRecord) {
  return {
    ...scan,
    takenAt: scan.takenAt.toISOString(),
    createdAt: scan.createdAt.toISOString()
  };
}

export function serializeMessage(message: MessageRecord) {
  return {
    ...message,
    createdAt: message.createdAt.toISOString()
  };
}

export function serializeTask(task: ShiftTask) {
  return {
    ...task,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString()
  };
}

export function serializeVital(vital: VitalRecord) {
  return {
    ...vital,
    recordedAt: vital.recordedAt.toISOString()
  };
}

export function serializeMedication(order: MedicationOrder) {
  return {
    ...order,
    prescribedAt: order.prescribedAt.toISOString(),
    startDate: order.startDate.toISOString().slice(0, 10),
    endDate: order.endDate ? order.endDate.toISOString().slice(0, 10) : null
  };
}

export function serializeMedicationAdministration(item: MedicationAdministration) {
  return {
    ...item,
    administeredAt: item.administeredAt.toISOString()
  };
}

export function serializeLabResult(lab: LabResult) {
  return {
    ...lab,
    collectedAt: lab.collectedAt.toISOString(),
    reportedAt: lab.reportedAt.toISOString()
  };
}

export function serializeTheatreCase(item: TheatreCase) {
  return {
    ...item,
    scheduledAt: item.scheduledAt.toISOString()
  };
}

export function serializeTransfer(item: TransferRecord) {
  return {
    ...item,
    createdAt: item.createdAt.toISOString()
  };
}

export function serializeDocument(item: DocumentRecord) {
  return {
    ...item,
    createdAt: item.createdAt.toISOString()
  };
}

export function serializeEmailLog(item: EmailLog) {
  return {
    ...item,
    createdAt: item.createdAt.toISOString()
  };
}

export function serializeArrival(item: ArrivalRecord) {
  return {
    ...item,
    broughtInAt: item.broughtInAt.toISOString(),
    createdAt: item.createdAt.toISOString()
  };
}
