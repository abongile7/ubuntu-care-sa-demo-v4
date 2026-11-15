import type { Role } from "@prisma/client";

export const encounterStatuses = [
  "REQUESTED",
  "DISPATCHED",
  "ON_SCENE",
  "IN_TRANSIT",
  "HANDED_OVER",
  "ADMITTED",
  "IN_CARE",
  "READY_FOR_DISCHARGE",
  "DISCHARGED"
] as const;
export type EncounterStatus = (typeof encounterStatuses)[number];
export const transitionRoles: Record<string, readonly Role[]> = {
  DISPATCHED: ["admin", "paramedic"],
  ON_SCENE: ["paramedic"],
  IN_TRANSIT: ["paramedic"],
  HANDED_OVER: ["paramedic", "nurse"],
  ADMITTED: ["admin", "nurse"],
  IN_CARE: ["doctor", "nurse"],
  READY_FOR_DISCHARGE: ["doctor"],
  DISCHARGED: ["admin", "nurse"]
};
export const roleLabels: Record<Role, string> = {
  patient: "Patient",
  doctor: "Doctor",
  nurse: "Nurse",
  admin: "Admissions",
  paramedic: "Ambulance crew",
  billing: "Hospital billing",
  insurer: "Medical aid"
};
export function readable(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}
export const serviceModes = {
  identity: { mode: "simulated", label: "Home Affairs verification simulation" },
  medicalAid: {
    mode: "simulated",
    label: "Medical-aid eligibility, authorisation and claims simulation"
  },
  calls: { mode: "simulated", label: "Call simulation — no phone calls are placed" }
};
