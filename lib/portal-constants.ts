export const portalDepartments = [
  "Admissions",
  "Emergency & ambulance",
  "General Medicine",
  "Nursing",
  "Maternity",
  "Paediatrics",
  "Surgery & theatre",
  "Laboratory",
  "Radiology",
  "Pharmacy",
  "Rehabilitation",
  "Dietetics",
  "Critical care",
  "Oncology",
  "Mental health",
  "Billing",
  "Medical records",
  "Patient services",
  "Discharge & follow-up",
  "Facilities & infection prevention"
] as const;
export const concernCategories = [
  "CARE_QUESTION",
  "MEDICATION",
  "ADMINISTRATION",
  "DISCHARGE",
  "OTHER",
  "BILLING"
] as const;
export const taskStatuses = ["OPEN", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"] as const;
export const portalOrganizations = [
  { name: "Discovery Health Medical Scheme", website: "https://www.discovery.co.za/" },
  { name: "Bonitas Medical Fund", website: "https://www.bonitas.co.za/" },
  { name: "Momentum Medical Scheme", website: "https://www.momentumhealth.co.za/" },
  { name: "Medihelp", website: "https://www.medihelp.co.za/" },
  { name: "Fedhealth", website: "https://www.fedhealth.co.za/" },
  { name: "Bestmed", website: "https://www.bestmed.co.za/" }
].map((item) => ({ ...item, mode: "simulated" as const }));
