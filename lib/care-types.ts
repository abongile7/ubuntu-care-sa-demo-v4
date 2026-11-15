import type { Role } from "@prisma/client";

export type JourneyActor = {
  id: string;
  name: string;
  email: string;
  role: Role;
  unit: string;
  organization?: string;
};
export type JourneyPatient = {
  id: string;
  fullName: string;
  facilityFileNumber: string;
  medicalAidScheme: string;
  allergies?: string;
  chronicConditions?: string;
  phone?: string;
  memberNumberMasked?: string;
  consentDataSharing?: boolean;
  popiaConsent?: boolean;
  consentTreatment?: boolean;
};
export type JourneyEncounter = {
  id: string;
  reference: string;
  patientId: string;
  patient: JourneyPatient;
  status: string;
  version: number;
  openedAt: string;
  closedAt: string | null;
  chiefComplaint?: string;
  location?: string;
  crewUserId?: string | null;
  triage?: string;
  ward?: string;
  bed?: string;
  diagnosisCode?: string;
  clinicalSummary?: string;
  dischargeSummary?: string;
  hasDischargeSummary?: boolean;
};
export type ClaimLine = {
  id: string;
  serviceCode: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};
export type JourneyClaim = {
  id: string;
  reference: string;
  encounterId: string;
  status: string;
  version: number;
  scheme: string;
  totalCents: number;
  patientLiabilityCents: number;
  reviewNote: string;
  diagnosisCode?: string;
  authorizationReference?: string;
  memberNumberMasked?: string;
  lineItems?: ClaimLine[];
  sharedWithInsurer?: boolean;
  packet?: Record<string, unknown>;
};
export type JourneyLab = {
  id: string;
  reference: string;
  testName: string;
  specimen: string;
  status: string;
  resultSummary: string;
  abnormalFlag: string;
  createdAt: string;
};
export type JourneyPayload = {
  ok: boolean;
  session: JourneyActor;
  patients: JourneyPatient[];
  crew: { id: string; name: string }[];
  encounters: JourneyEncounter[];
  activeEncounter: JourneyEncounter | null;
  calls: {
    id: string;
    direction: string;
    purpose: string;
    contactName: string;
    phone: string;
    summary: string;
    status: string;
    createdAt: string;
  }[];
  notes: { id: string; category: string; body: string; authorName: string; createdAt: string }[];
  labOrders: JourneyLab[];
  identityChecks: {
    id: string;
    status: string;
    idLast4: string;
    providerReference: string;
    createdAt: string;
  }[];
  eligibilityChecks: {
    id: string;
    status: string;
    authorizationStatus: string;
    authorizationReference: string;
    memberNumberMasked: string;
    scheme: string;
    createdAt: string;
  }[];
  claims: JourneyClaim[];
  audit: { id: string; action: string; actorName?: string; details?: string; createdAt: string }[];
  vitals: {
    id: string;
    systolic: number;
    diastolic: number;
    pulse: number;
    spo2: number;
    temperature: number;
    recordedAt: string;
  }[];
  medications: {
    id: string;
    drugName: string;
    dose: string;
    route: string;
    frequency: string;
    status: string;
  }[];
  administrations: {
    id: string;
    orderId: string;
    administeredBy: string;
    status: string;
    notes: string;
    administeredAt: string;
  }[];
};
