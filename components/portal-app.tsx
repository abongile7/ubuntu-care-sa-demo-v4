"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import {
  appointmentStatuses,
  appointmentTypes,
  arrivalModes,
  channels,
  contactMethods,
  departments,
  documentCategories,
  hospitalMeta,
  labProviders,
  languages,
  maritalStatuses,
  medicalAidSchemes,
  medicationRoutes,
  provinces,
  scanModalities,
  staffDirectory,
  taskPriorities,
  taskStatuses,
  theatreStatuses,
  transferTypes,
  triageLevels
} from "@/lib/demo-data";

type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  unit: string;
};

type CaseListItem = {
  id: string;
  fullName: string;
  facilityFileNumber: string;
  province: string;
  visitPathway: string;
  medicalAidScheme: string;
  triagePriority: string;
  ward: string;
  updatedAt: string;
};

type PatientShape = {
  id: string;
  facilityFileNumber: string;
  fullName: string;
  saId: string;
  passportNumber: string;
  citizenship: string;
  dateOfBirth: string;
  gender: string;
  phone: string;
  email: string;
  language: string;
  preferredContactMethod: string;
  province: string;
  city: string;
  address: string;
  postalCode: string;
  maritalStatus: string;
  occupation: string;
  employer: string;
  employerPhone: string;
  religion: string;
  homeClinic: string;
  arrivalMode: string;
  arrivalReason: string;
  broughtBy: string;
  referralSource: string;
  referringDoctor: string;
  transferredFrom: string;
  transferReason: string;
  medicalAidScheme: string;
  medicalAidPlan: string;
  medicalAidNumber: string;
  membershipTier: string;
  principalMemberName: string;
  principalMemberNumber: string;
  relationshipToPrincipalMember: string;
  nextOfKin: string;
  nextOfKinRelation: string;
  nextOfKinPhone: string;
  guardianName: string;
  guardianPhone: string;
  bloodType: string;
  allergies: string;
  currentMedication: string;
  chronicConditions: string;
  disabilitySupport: string;
  pregnancyStatus: string;
  visitPathway: string;
  triagePriority: string;
  ward: string;
  bedNumber: string;
  interpreterRequired: boolean;
  popiaConsent: boolean;
  consentTreatment: boolean;
  consentDataSharing: boolean;
  consentBilling: boolean;
};

type AppointmentShape = {
  id: string;
  reference: string;
  patientId: string;
  department: string;
  clinician: string;
  scheduledAt: string;
  type: string;
  status: string;
  location: string;
  notes: string;
  createdByRole: Role;
};

type ScanShape = {
  id: string;
  reference: string;
  patientId: string;
  title: string;
  modality: string;
  takenAt: string;
  department: string;
  uploadedBy: string;
  uploadedByRole: Role;
  notes: string;
  previewData: string;
};

type MessageShape = {
  id: string;
  reference: string;
  channel: string;
  authorName: string;
  authorRole: Role;
  body: string;
  createdAt: string;
};

type TaskShape = {
  id: string;
  reference: string;
  title: string;
  owner: string;
  department: string;
  priority: string;
  status: string;
  eta: string;
};

type VitalShape = {
  id: string;
  reference: string;
  patientId: string;
  recordedBy: string;
  recordedByRole: Role;
  recordedAt: string;
  systolic: number;
  diastolic: number;
  pulse: number;
  temperature: number;
  respiratoryRate: number;
  spo2: number;
  glucose: string;
  painScore: number;
  notes: string;
};

type MedicationShape = {
  id: string;
  reference: string;
  patientId: string;
  prescribedBy: string;
  prescribedByRole: Role;
  prescribedAt: string;
  drugName: string;
  dose: string;
  route: string;
  frequency: string;
  indication: string;
  startDate: string;
  endDate: string | null;
  status: string;
};

type AdministrationShape = {
  id: string;
  reference: string;
  orderId: string;
  patientId: string;
  administeredBy: string;
  administeredByRole: Role;
  administeredAt: string;
  status: string;
  notes: string;
};

type LabShape = {
  id: string;
  reference: string;
  patientId: string;
  provider: string;
  testName: string;
  specimen: string;
  collectedAt: string;
  reportedAt: string;
  resultSummary: string;
  abnormalFlag: string;
  fileUrl: string;
  uploadedBy: string;
  uploadedByRole: Role;
};

type TheatreShape = {
  id: string;
  reference: string;
  patientId: string;
  procedureName: string;
  specialty: string;
  surgeon: string;
  anaesthetist: string;
  theatreRoom: string;
  scheduledAt: string;
  urgency: string;
  status: string;
  notes: string;
};

type TransferShape = {
  id: string;
  reference: string;
  patientId: string;
  type: string;
  sourceFacility: string;
  destinationFacility: string;
  transportMode: string;
  escortType: string;
  reason: string;
  requestedBy: string;
  status: string;
  eta: string;
  createdAt: string;
};

type DocumentShape = {
  id: string;
  reference: string;
  patientId: string;
  category: string;
  title: string;
  body: string;
  authorName: string;
  authorRole: Role;
  createdAt: string;
};

type EmailShape = {
  id: string;
  reference: string;
  patientId: string;
  recipient: string;
  subject: string;
  category: string;
  sentBy: string;
  status: string;
  createdAt: string;
};

type ArrivalShape = {
  id: string;
  reference: string;
  patientId: string;
  patientName: string;
  arrivalMode: string;
  source: string;
  triageColor: string;
  casualtyArea: string;
  handoverNotes: string;
  broughtInAt: string;
  status: string;
  createdBy: string;
};

type DashboardPayload = {
  ok: boolean;
  session: SessionUser;
  hospitalMeta: typeof hospitalMeta;
  staffDirectory: (typeof staffDirectory)[number][];
  roleCapabilities: Record<string, boolean>;
  cases: CaseListItem[];
  activePatient: PatientShape;
  appointments: AppointmentShape[];
  scans: ScanShape[];
  messages: MessageShape[];
  tasks: TaskShape[];
  vitals: VitalShape[];
  medications: MedicationShape[];
  administrations: AdministrationShape[];
  labs: LabShape[];
  theatreCases: TheatreShape[];
  transfers: TransferShape[];
  documents: DocumentShape[];
  emails: EmailShape[];
  arrivals: ArrivalShape[];
  admissions: {
    status: string;
    pathway: string;
    ward: string;
    bedNumber: string;
    triage: string;
    funding: string;
    arrival: string;
    completeness: number;
  };
  insights: {
    avgBloodPressure: string;
    activeMedicationCount: number;
    abnormalLabs: number;
    nextAppointment: string;
  };
  facilityMetrics: {
    totalCases: number;
    activeTasks: number;
    transfersToday: number;
    ambulanceArrivals: number;
    theatreCasesToday: number;
    pendingEmails: number;
  };
};

type Notice = {
  type: "success" | "error";
  text: string;
};

const initialNotice: Notice | null = null;

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function roleTheme(role: Role) {
  if (role === "doctor") return "theme-doctor";
  if (role === "nurse") return "theme-nurse";
  if (role === "admin") return "theme-admin";
  return "theme-patient";
}

function smallDate(value: string) {
  return new Date(value).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short"
  });
}

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = (await response.json()) as { ok: boolean; message?: string };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message ?? "Request failed.");
  }
}

async function patchJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = (await response.json()) as { ok: boolean; message?: string };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message ?? "Request failed.");
  }
}

async function putJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = (await response.json()) as { ok: boolean; message?: string };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message ?? "Request failed.");
  }
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function SectionCard({
  title,
  kicker,
  children,
  action
}: {
  title: string;
  kicker?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="surface-card portal-section">
      <div className="section-topline">
        <div>
          {kicker ? <span className="section-kicker">{kicker}</span> : null}
          <h3>{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PortalApp({ initialSession }: { initialSession: SessionUser }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser>(initialSession);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(initialNotice);
  const [activePatientId, setActivePatientId] = useState("");
  const [profileDraft, setProfileDraft] = useState<PatientShape | null>(null);

  const [appointmentDraft, setAppointmentDraft] = useState({
    department: "General Medicine",
    clinician: "TBD",
    scheduledAt: "",
    type: "General consultation",
    location: "UbuntuCare Main Campus",
    notes: ""
  });

  const [messageDraft, setMessageDraft] = useState({
    channel: "Ward",
    body: ""
  });

  const [taskDraft, setTaskDraft] = useState({
    title: "",
    owner: session.name,
    department: session.unit,
    priority: "Standard",
    eta: ""
  });

  const [scanDraft, setScanDraft] = useState({
    title: "",
    modality: "MRI",
    department: "Radiology",
    notes: "",
    previewData: ""
  });

  const [vitalDraft, setVitalDraft] = useState({
    systolic: "120",
    diastolic: "80",
    pulse: "72",
    temperature: "36.6",
    respiratoryRate: "18",
    spo2: "98",
    glucose: "5.6 mmol/L",
    painScore: "0",
    notes: ""
  });

  const [medicationDraft, setMedicationDraft] = useState({
    drugName: "",
    dose: "",
    route: "Oral",
    frequency: "",
    indication: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: ""
  });

  const [medAdminDraft, setMedAdminDraft] = useState({
    orderId: "",
    status: "Given",
    notes: ""
  });

  const [labDraft, setLabDraft] = useState({
    provider: "Ampath",
    testName: "",
    specimen: "Blood",
    collectedAt: new Date().toISOString().slice(0, 16),
    reportedAt: new Date().toISOString().slice(0, 16),
    abnormalFlag: "Normal",
    resultSummary: "",
    fileUrl: ""
  });

  const [theatreDraft, setTheatreDraft] = useState({
    procedureName: "",
    specialty: "",
    surgeon: session.name,
    anaesthetist: "",
    theatreRoom: "Theatre 1",
    scheduledAt: new Date().toISOString().slice(0, 16),
    urgency: "Elective",
    notes: ""
  });

  const [transferDraft, setTransferDraft] = useState({
    type: "Inter-hospital transfer",
    sourceFacility: "UbuntuCare Private Hospital",
    destinationFacility: "",
    transportMode: "Ambulance",
    escortType: "",
    reason: "",
    eta: ""
  });

  const [documentDraft, setDocumentDraft] = useState({
    category: "Sick note",
    title: "",
    body: ""
  });

  const [emailDraft, setEmailDraft] = useState({
    recipient: "",
    subject: "",
    category: "Document"
  });

  const [arrivalDraft, setArrivalDraft] = useState({
    patientName: "",
    arrivalMode: "Walk-in",
    source: "Self referral",
    triageColor: "Green",
    casualtyArea: "Casualty triage",
    handoverNotes: "",
    status: "Awaiting review"
  });

  useEffect(() => {
    void loadDashboard(activePatientId);
  }, [activePatientId]);

  async function loadDashboard(patientId?: string) {
    setLoading(true);
    try {
      const response = await fetch(`/api/dashboard${patientId ? `?patientId=${patientId}` : ""}`);
      const payload = (await response.json()) as DashboardPayload;

      if (!response.ok || !payload.ok) {
        throw new Error("Unable to load portal data.");
      }

      setSession(payload.session);
      setDashboard(payload);
      setProfileDraft(payload.activePatient);
      if (!activePatientId || session.role === "patient") {
        setActivePatientId(payload.activePatient.id);
      }
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to load portal data."
      });
    } finally {
      setLoading(false);
    }
  }

  async function withRefresh(work: () => Promise<void>, successText: string) {
    setNotice(null);
    try {
      await work();
      await loadDashboard(activePatientId);
      setNotice({ type: "success", text: successText });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Action failed."
      });
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const themeClass = useMemo(() => roleTheme(session.role), [session.role]);
  const latestScan = dashboard?.scans[0];
  const latestLab = dashboard?.labs[0];
  const latestDocument = dashboard?.documents[0];
  const medicationOptions = dashboard?.medications ?? [];
  const activeAdministrations = dashboard?.administrations ?? [];

  function updateProfileField(field: keyof PatientShape, value: string | boolean) {
    setProfileDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  async function saveProfile() {
    if (!profileDraft) return;

    await withRefresh(
      async () => {
        await putJson("/api/profile", profileDraft as unknown as Record<string, unknown>);
      },
      "Patient profile saved."
    );
  }

  async function submitAppointment() {
    if (!dashboard) return;

    await withRefresh(
      async () => {
        await postJson("/api/appointments", {
          patientId: dashboard.activePatient.id,
          ...appointmentDraft
        });
      },
      "Appointment saved."
    );
  }

  async function updateAppointmentStatus(appointmentId: string, status: string) {
    await withRefresh(
      async () => {
        await patchJson("/api/appointments", {
          appointmentId,
          status
        });
      },
      "Appointment status updated."
    );
  }

  async function submitMessage() {
    await withRefresh(
      async () => {
        await postJson("/api/messages", messageDraft);
        setMessageDraft((current) => ({ ...current, body: "" }));
      },
      "Message posted to channel."
    );
  }

  async function submitTask() {
    await withRefresh(
      async () => {
        await postJson("/api/tasks", taskDraft);
        setTaskDraft({
          title: "",
          owner: session.name,
          department: session.unit,
          priority: "Standard",
          eta: ""
        });
      },
      "Operational task created."
    );
  }

  async function updateTaskStatus(taskId: string, status: string) {
    await withRefresh(
      async () => {
        await patchJson("/api/tasks", { taskId, status });
      },
      "Task updated."
    );
  }

  async function submitScan() {
    if (!dashboard) return;

    await withRefresh(
      async () => {
        await postJson("/api/scans", {
          patientId: dashboard.activePatient.id,
          ...scanDraft,
          previewData: scanDraft.previewData || "/scan-preview.svg"
        });
        setScanDraft({
          title: "",
          modality: "MRI",
          department: "Radiology",
          notes: "",
          previewData: ""
        });
      },
      "Scan uploaded."
    );
  }

  async function submitVitals() {
    if (!dashboard) return;

    await withRefresh(
      async () => {
        await postJson("/api/vitals", {
          patientId: dashboard.activePatient.id,
          ...vitalDraft
        });
        setVitalDraft({
          systolic: "120",
          diastolic: "80",
          pulse: "72",
          temperature: "36.6",
          respiratoryRate: "18",
          spo2: "98",
          glucose: "5.6 mmol/L",
          painScore: "0",
          notes: ""
        });
      },
      "Vitals recorded."
    );
  }

  async function prescribeMedication() {
    if (!dashboard) return;

    await withRefresh(
      async () => {
        await postJson("/api/medications", {
          action: "prescribe",
          patientId: dashboard.activePatient.id,
          ...medicationDraft
        });
        setMedicationDraft({
          drugName: "",
          dose: "",
          route: "Oral",
          frequency: "",
          indication: "",
          startDate: new Date().toISOString().slice(0, 10),
          endDate: ""
        });
      },
      "Medication order created."
    );
  }

  async function administerMedication() {
    if (!medAdminDraft.orderId) return;

    await withRefresh(
      async () => {
        await postJson("/api/medications", {
          action: "administer",
          ...medAdminDraft
        });
        setMedAdminDraft({
          orderId: "",
          status: "Given",
          notes: ""
        });
      },
      "Medication administration logged."
    );
  }

  async function submitLab() {
    if (!dashboard) return;

    await withRefresh(
      async () => {
        await postJson("/api/labs", {
          patientId: dashboard.activePatient.id,
          ...labDraft
        });
        setLabDraft({
          provider: "Ampath",
          testName: "",
          specimen: "Blood",
          collectedAt: new Date().toISOString().slice(0, 16),
          reportedAt: new Date().toISOString().slice(0, 16),
          abnormalFlag: "Normal",
          resultSummary: "",
          fileUrl: ""
        });
      },
      "Lab result captured."
    );
  }

  async function submitTheatre() {
    if (!dashboard) return;

    await withRefresh(
      async () => {
        await postJson("/api/theatre", {
          patientId: dashboard.activePatient.id,
          ...theatreDraft
        });
        setTheatreDraft({
          procedureName: "",
          specialty: "",
          surgeon: session.name,
          anaesthetist: "",
          theatreRoom: "Theatre 1",
          scheduledAt: new Date().toISOString().slice(0, 16),
          urgency: "Elective",
          notes: ""
        });
      },
      "Theatre case booked."
    );
  }

  async function updateTheatreStatus(caseId: string, status: string) {
    await withRefresh(
      async () => {
        await patchJson("/api/theatre", { caseId, status });
      },
      "Theatre case updated."
    );
  }

  async function submitTransfer() {
    if (!dashboard) return;

    await withRefresh(
      async () => {
        await postJson("/api/transfers", {
          patientId: dashboard.activePatient.id,
          ...transferDraft
        });
        setTransferDraft({
          type: "Inter-hospital transfer",
          sourceFacility: "UbuntuCare Private Hospital",
          destinationFacility: "",
          transportMode: "Ambulance",
          escortType: "",
          reason: "",
          eta: ""
        });
      },
      "Transfer or transport booking saved."
    );
  }

  async function submitDocument() {
    if (!dashboard) return;

    await withRefresh(
      async () => {
        await postJson("/api/documents", {
          patientId: dashboard.activePatient.id,
          ...documentDraft
        });
        setDocumentDraft({
          category: "Sick note",
          title: "",
          body: ""
        });
      },
      "Document created."
    );
  }

  async function submitEmail() {
    if (!dashboard) return;

    await withRefresh(
      async () => {
        await postJson("/api/emails", {
          patientId: dashboard.activePatient.id,
          ...emailDraft
        });
        setEmailDraft({
          recipient: "",
          subject: "",
          category: "Document"
        });
      },
      "Email queued."
    );
  }

  async function submitArrival() {
    if (!dashboard) return;

    await withRefresh(
      async () => {
        await postJson("/api/arrivals", { patientId: dashboard?.activePatient.id, ...arrivalDraft });
        setArrivalDraft({
          patientName: "",
          arrivalMode: "Walk-in",
          source: "Self referral",
          triageColor: "Green",
          casualtyArea: "Casualty triage",
          handoverNotes: "",
          status: "Awaiting review"
        });
      },
      "Arrival registered."
    );
  }

  async function onImageSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setScanDraft((current) => ({
        ...current,
        previewData: String(reader.result ?? "")
      }));
    };
    reader.readAsDataURL(file);
  }

  if (loading && !dashboard) {
    return <div className="surface-card loading-state">Loading hospital workspace…</div>;
  }

  if (!dashboard || !profileDraft) {
    return <div className="surface-card loading-state">Unable to load dashboard.</div>;
  }

  const currentPatient = dashboard.activePatient;
  const latestVitals = dashboard.vitals[0];
  const staffFilteredMessages =
    session.role === "patient"
      ? dashboard.messages.filter((message) => ["Admissions", "Radiology", "Ward", "Laboratory"].includes(message.channel))
      : dashboard.messages;

  return (
    <div className={`portal-shell ${themeClass}`}>
      <header className="surface-card portal-header">
        <div>
          <span className="section-kicker">
            {hospitalMeta.name} · {session.role.toUpperCase()} workspace
          </span>
          <h1>{session.role === "patient" ? "Your hospital portal" : `${session.name}'s dashboard`}</h1>
          <p>
            {session.role === "patient"
              ? "Follow your admission, upcoming appointments, medicines, scans, documents, and care updates."
              : "Run clinical, ward, admissions, casualty, transfer, and document workflows from one screen."}
          </p>
        </div>

        <div className="portal-header-actions">
          <div className="user-chip">
            <span className="status-dot" />
            <div>
              <strong>{session.name}</strong>
              <small>
                {session.unit} · mobile and laptop ready
              </small>
            </div>
          </div>
          <button type="button" className="button button-secondary" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      {notice ? <div className={`notice-banner ${notice.type}`}>{notice.text}</div> : null}

      <section className="portal-grid portal-top-grid">
        <SectionCard title="Active case" kicker="Patient context">
          <div className="summary-hero">
            <div>
              <h2>{currentPatient.fullName}</h2>
              <p>
                {currentPatient.facilityFileNumber} · {currentPatient.visitPathway} · {currentPatient.ward}{" "}
                {currentPatient.bedNumber ? `· ${currentPatient.bedNumber}` : ""}
              </p>
            </div>
            <div className="score-ring">
              <strong>{dashboard.admissions.completeness}%</strong>
              <span>file complete</span>
            </div>
          </div>

          <div className="summary-chip-grid">
            <span className="soft-chip">Triage {dashboard.admissions.triage}</span>
            <span className="soft-chip">{dashboard.admissions.funding}</span>
            <span className="soft-chip">{dashboard.insights.avgBloodPressure} avg BP</span>
            <span className="soft-chip">{dashboard.insights.activeMedicationCount} active meds</span>
          </div>

          {session.role !== "patient" ? (
            <label>
              Switch patient case
              <select value={activePatientId} onChange={(event) => setActivePatientId(event.target.value)}>
                {dashboard.cases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName} · {item.ward} · {item.triagePriority}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </SectionCard>

        <SectionCard title="Operational insights" kicker="What matters now">
          <div className="mini-metric-grid">
            <div className="mini-metric">
              <strong>{dashboard.insights.nextAppointment}</strong>
              <span>Next appointment</span>
            </div>
            <div className="mini-metric">
              <strong>{dashboard.insights.avgBloodPressure}</strong>
              <span>Average BP</span>
            </div>
            <div className="mini-metric">
              <strong>{dashboard.insights.abnormalLabs}</strong>
              <span>Abnormal lab flags</span>
            </div>
            <div className="mini-metric">
              <strong>{dashboard.facilityMetrics.ambulanceArrivals}</strong>
              <span>Ambulance arrivals</span>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Featured care team" kicker="Doctors, nurses, admin">
          <div className="staff-list">
            {dashboard.staffDirectory.map((person) => (
              <article key={person.id} className="staff-list-card">
                <img src={person.image} alt={person.name} className="staff-photo" />
                <div>
                  <strong>{person.name}</strong>
                  <span>{person.title}</span>
                  <small>
                    {person.department} · {person.specialization}
                  </small>
                </div>
              </article>
            ))}
          </div>
        </SectionCard>
      </section>

      <section className="portal-grid portal-main-grid">
        {session.role === "patient" ? (
          <>
            <SectionCard title="My admission and contact details" kicker="Paperless profile" action={<button className="button button-primary" type="button" onClick={saveProfile}>Save</button>}>
              <div className="form-grid form-grid-3">
                <label>
                  Full name
                  <input value={profileDraft.fullName} onChange={(event) => updateProfileField("fullName", event.target.value)} />
                </label>
                <label>
                  SA ID
                  <input value={profileDraft.saId} onChange={(event) => updateProfileField("saId", event.target.value)} />
                </label>
                <label>
                  Date of birth
                  <input type="date" value={profileDraft.dateOfBirth} onChange={(event) => updateProfileField("dateOfBirth", event.target.value)} />
                </label>
                <label>
                  Phone
                  <input value={profileDraft.phone} onChange={(event) => updateProfileField("phone", event.target.value)} />
                </label>
                <label>
                  Email
                  <input value={profileDraft.email} onChange={(event) => updateProfileField("email", event.target.value)} />
                </label>
                <label>
                  Preferred contact
                  <select value={profileDraft.preferredContactMethod} onChange={(event) => updateProfileField("preferredContactMethod", event.target.value)}>
                    {contactMethods.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Province
                  <select value={profileDraft.province} onChange={(event) => updateProfileField("province", event.target.value)}>
                    {provinces.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Language
                  <select value={profileDraft.language} onChange={(event) => updateProfileField("language", event.target.value)}>
                    {languages.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Marital status
                  <select value={profileDraft.maritalStatus} onChange={(event) => updateProfileField("maritalStatus", event.target.value)}>
                    {maritalStatuses.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="full-span">
                  Address
                  <input value={profileDraft.address} onChange={(event) => updateProfileField("address", event.target.value)} />
                </label>
                <label>
                  Medical aid
                  <select value={profileDraft.medicalAidScheme} onChange={(event) => updateProfileField("medicalAidScheme", event.target.value)}>
                    {medicalAidSchemes.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Medical aid no.
                  <input value={profileDraft.medicalAidNumber} onChange={(event) => updateProfileField("medicalAidNumber", event.target.value)} />
                </label>
                <label>
                  Principal member
                  <input value={profileDraft.principalMemberName} onChange={(event) => updateProfileField("principalMemberName", event.target.value)} />
                </label>
                <label>
                  Next of kin
                  <input value={profileDraft.nextOfKin} onChange={(event) => updateProfileField("nextOfKin", event.target.value)} />
                </label>
                <label>
                  Next of kin phone
                  <input value={profileDraft.nextOfKinPhone} onChange={(event) => updateProfileField("nextOfKinPhone", event.target.value)} />
                </label>
                <label>
                  Arrival reason
                  <input value={profileDraft.arrivalReason} onChange={(event) => updateProfileField("arrivalReason", event.target.value)} />
                </label>
              </div>
            </SectionCard>

            <SectionCard title="Appointments, medications, and results" kicker="Your care journey">
              <div className="stacked-columns">
                <div>
                  <h4>Appointments</h4>
                  {dashboard.appointments.length ? (
                    <div className="list-stack">
                      {dashboard.appointments.map((appointment) => (
                        <article key={appointment.id} className="line-card">
                          <strong>{appointment.type}</strong>
                          <span>{formatDateTime(appointment.scheduledAt)}</span>
                          <small>
                            {appointment.department} · {appointment.clinician} · {appointment.status}
                          </small>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="No appointments" text="Bookings will show here." />
                  )}
                </div>

                <div>
                  <h4>Active medication</h4>
                  {dashboard.medications.length ? (
                    <div className="list-stack">
                      {dashboard.medications.map((item) => (
                        <article key={item.id} className="line-card">
                          <strong>
                            {item.drugName} {item.dose}
                          </strong>
                          <span>
                            {item.route} · {item.frequency}
                          </span>
                          <small>{item.indication}</small>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="No medication orders" text="Your doctor’s orders will appear here." />
                  )}
                </div>

                <div>
                  <h4>Results and documents</h4>
                  <div className="list-stack">
                    {latestLab ? (
                      <article className="line-card">
                        <strong>
                          {latestLab.provider} · {latestLab.testName}
                        </strong>
                        <span>{latestLab.abnormalFlag}</span>
                        <small>{latestLab.resultSummary}</small>
                      </article>
                    ) : null}
                    {latestDocument ? (
                      <article className="line-card">
                        <strong>{latestDocument.title}</strong>
                        <span>{latestDocument.category}</span>
                        <small>{latestDocument.body}</small>
                      </article>
                    ) : null}
                    {!latestLab && !latestDocument ? (
                      <EmptyState title="No results yet" text="Labs, letters, and release documents will appear here." />
                    ) : null}
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Scans and updates" kicker="Imaging and communication">
              <div className="dual-pane">
                <div className="scan-viewer">
                  <img src={latestScan?.previewData || "/scan-preview.svg"} alt="Latest scan preview" />
                  <div className="scan-caption">
                    <strong>{latestScan?.title ?? "No scan uploaded yet"}</strong>
                    <span>{latestScan ? `${latestScan.modality} · ${smallDate(latestScan.takenAt)}` : "MRI / CT / X-ray previews appear here."}</span>
                  </div>
                </div>

                <div>
                  <h4>Case updates</h4>
                  <div className="list-stack">
                    {staffFilteredMessages.slice(0, 6).map((message) => (
                      <article key={message.id} className="line-card">
                        <strong>
                          {message.channel} · {message.authorName}
                        </strong>
                        <span>{formatDateTime(message.createdAt)}</span>
                        <small>{message.body}</small>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        ) : null}

        {session.role === "doctor" ? (
          <>
            <SectionCard title="Doctor cockpit" kicker="Clinical review">
              <div className="mini-metric-grid">
                <div className="mini-metric">
                  <strong>{currentPatient.allergies || "None listed"}</strong>
                  <span>Allergies</span>
                </div>
                <div className="mini-metric">
                  <strong>{currentPatient.chronicConditions || "None"}</strong>
                  <span>Chronic conditions</span>
                </div>
                <div className="mini-metric">
                  <strong>{latestVitals ? `${latestVitals.systolic}/${latestVitals.diastolic}` : "—"}</strong>
                  <span>Latest BP</span>
                </div>
                <div className="mini-metric">
                  <strong>{latestLab?.abnormalFlag ?? "No lab"}</strong>
                  <span>Latest lab flag</span>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Prescribe medication" kicker="Doctor action" action={<button className="button button-primary" type="button" onClick={prescribeMedication}>Add order</button>}>
              <div className="form-grid form-grid-3">
                <label>
                  Drug name
                  <input value={medicationDraft.drugName} onChange={(event) => setMedicationDraft({ ...medicationDraft, drugName: event.target.value })} />
                </label>
                <label>
                  Dose
                  <input value={medicationDraft.dose} onChange={(event) => setMedicationDraft({ ...medicationDraft, dose: event.target.value })} />
                </label>
                <label>
                  Route
                  <select value={medicationDraft.route} onChange={(event) => setMedicationDraft({ ...medicationDraft, route: event.target.value })}>
                    {medicationRoutes.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Frequency
                  <input value={medicationDraft.frequency} onChange={(event) => setMedicationDraft({ ...medicationDraft, frequency: event.target.value })} />
                </label>
                <label>
                  Indication
                  <input value={medicationDraft.indication} onChange={(event) => setMedicationDraft({ ...medicationDraft, indication: event.target.value })} />
                </label>
                <label>
                  Start date
                  <input type="date" value={medicationDraft.startDate} onChange={(event) => setMedicationDraft({ ...medicationDraft, startDate: event.target.value })} />
                </label>
              </div>

              <div className="list-stack compact-top">
                {dashboard.medications.map((item) => (
                  <article key={item.id} className="line-card">
                    <strong>{item.drugName} {item.dose}</strong>
                    <span>{item.route} · {item.frequency}</span>
                    <small>{item.indication} · ordered by {item.prescribedBy}</small>
                  </article>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Nursing observations and blood pressure trend" kicker="Daily monitoring">
              {dashboard.vitals.length ? (
                <div className="table-shell">
                  <table>
                    <thead>
                      <tr>
                        <th>Recorded</th>
                        <th>BP</th>
                        <th>Pulse</th>
                        <th>Temp</th>
                        <th>SpO₂</th>
                        <th>Glucose</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.vitals.map((item) => (
                        <tr key={item.id}>
                          <td>{formatDateTime(item.recordedAt)}</td>
                          <td>{item.systolic}/{item.diastolic}</td>
                          <td>{item.pulse}</td>
                          <td>{item.temperature.toFixed(1)}°C</td>
                          <td>{item.spo2}%</td>
                          <td>{item.glucose}</td>
                          <td>{item.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No vitals yet" text="Nursing observations will appear here." />
              )}
            </SectionCard>

            <SectionCard title="Ampath / lab results" kicker="Laboratory">
              <div className="form-grid form-grid-3">
                <label>
                  Provider
                  <select value={labDraft.provider} onChange={(event) => setLabDraft({ ...labDraft, provider: event.target.value })}>
                    {labProviders.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Test name
                  <input value={labDraft.testName} onChange={(event) => setLabDraft({ ...labDraft, testName: event.target.value })} />
                </label>
                <label>
                  Specimen
                  <input value={labDraft.specimen} onChange={(event) => setLabDraft({ ...labDraft, specimen: event.target.value })} />
                </label>
                <label>
                  Collected at
                  <input type="datetime-local" value={labDraft.collectedAt} onChange={(event) => setLabDraft({ ...labDraft, collectedAt: event.target.value })} />
                </label>
                <label>
                  Reported at
                  <input type="datetime-local" value={labDraft.reportedAt} onChange={(event) => setLabDraft({ ...labDraft, reportedAt: event.target.value })} />
                </label>
                <label>
                  Flag
                  <select value={labDraft.abnormalFlag} onChange={(event) => setLabDraft({ ...labDraft, abnormalFlag: event.target.value })}>
                    <option>Normal</option>
                    <option>Abnormal</option>
                    <option>Critical</option>
                  </select>
                </label>
                <label className="full-span">
                  Result summary
                  <textarea value={labDraft.resultSummary} onChange={(event) => setLabDraft({ ...labDraft, resultSummary: event.target.value })} />
                </label>
                <label className="full-span">
                  File URL
                  <input value={labDraft.fileUrl} onChange={(event) => setLabDraft({ ...labDraft, fileUrl: event.target.value })} placeholder="https://www.ampath.co.za/..." />
                </label>
              </div>
              <div className="action-row">
                <button className="button button-primary" type="button" onClick={submitLab}>Save lab result</button>
              </div>

              <div className="list-stack compact-top">
                {dashboard.labs.map((item) => (
                  <article key={item.id} className="line-card">
                    <strong>{item.provider} · {item.testName}</strong>
                    <span>{item.abnormalFlag} · {smallDate(item.reportedAt)}</span>
                    <small>{item.resultSummary}</small>
                  </article>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Imaging and theatre" kicker="Radiology and procedures">
              <div className="dual-pane">
                <div>
                  <div className="scan-viewer">
                    <img src={latestScan?.previewData || "/scan-preview.svg"} alt="Imaging preview" />
                  </div>
                  <div className="form-grid form-grid-2 compact-top">
                    <label>
                      Scan title
                      <input value={scanDraft.title} onChange={(event) => setScanDraft({ ...scanDraft, title: event.target.value })} />
                    </label>
                    <label>
                      Modality
                      <select value={scanDraft.modality} onChange={(event) => setScanDraft({ ...scanDraft, modality: event.target.value })}>
                        {scanModalities.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Department
                      <select value={scanDraft.department} onChange={(event) => setScanDraft({ ...scanDraft, department: event.target.value })}>
                        {departments.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Upload image
                      <input type="file" accept="image/*" onChange={onImageSelected} />
                    </label>
                    <label className="full-span">
                      Notes
                      <textarea value={scanDraft.notes} onChange={(event) => setScanDraft({ ...scanDraft, notes: event.target.value })} />
                    </label>
                  </div>
                  <div className="action-row">
                    <button className="button button-primary" type="button" onClick={submitScan}>Upload scan</button>
                  </div>
                </div>

                <div>
                  <div className="form-grid form-grid-2">
                    <label>
                      Procedure
                      <input value={theatreDraft.procedureName} onChange={(event) => setTheatreDraft({ ...theatreDraft, procedureName: event.target.value })} />
                    </label>
                    <label>
                      Specialty
                      <input value={theatreDraft.specialty} onChange={(event) => setTheatreDraft({ ...theatreDraft, specialty: event.target.value })} />
                    </label>
                    <label>
                      Anaesthetist
                      <input value={theatreDraft.anaesthetist} onChange={(event) => setTheatreDraft({ ...theatreDraft, anaesthetist: event.target.value })} />
                    </label>
                    <label>
                      Theatre room
                      <input value={theatreDraft.theatreRoom} onChange={(event) => setTheatreDraft({ ...theatreDraft, theatreRoom: event.target.value })} />
                    </label>
                    <label>
                      Scheduled at
                      <input type="datetime-local" value={theatreDraft.scheduledAt} onChange={(event) => setTheatreDraft({ ...theatreDraft, scheduledAt: event.target.value })} />
                    </label>
                    <label>
                      Urgency
                      <input value={theatreDraft.urgency} onChange={(event) => setTheatreDraft({ ...theatreDraft, urgency: event.target.value })} />
                    </label>
                    <label className="full-span">
                      Notes
                      <textarea value={theatreDraft.notes} onChange={(event) => setTheatreDraft({ ...theatreDraft, notes: event.target.value })} />
                    </label>
                  </div>
                  <div className="action-row">
                    <button className="button button-primary" type="button" onClick={submitTheatre}>Book theatre case</button>
                  </div>

                  <div className="list-stack compact-top">
                    {dashboard.theatreCases.map((item) => (
                      <article key={item.id} className="line-card">
                        <div className="line-card-row">
                          <strong>{item.procedureName}</strong>
                          <select value={item.status} onChange={(event) => void updateTheatreStatus(item.id, event.target.value)}>
                            {theatreStatuses.map((status) => (
                              <option key={status}>{status}</option>
                            ))}
                          </select>
                        </div>
                        <span>{formatDateTime(item.scheduledAt)} · {item.theatreRoom}</span>
                        <small>{item.surgeon} · {item.notes}</small>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Documents and release" kicker="Digital paperwork">
              <div className="form-grid form-grid-2">
                <label>
                  Document type
                  <select value={documentDraft.category} onChange={(event) => setDocumentDraft({ ...documentDraft, category: event.target.value })}>
                    {documentCategories.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Title
                  <input value={documentDraft.title} onChange={(event) => setDocumentDraft({ ...documentDraft, title: event.target.value })} />
                </label>
                <label className="full-span">
                  Document body
                  <textarea value={documentDraft.body} onChange={(event) => setDocumentDraft({ ...documentDraft, body: event.target.value })} />
                </label>
              </div>
              <div className="action-row">
                <button className="button button-primary" type="button" onClick={submitDocument}>Create document</button>
                <a className="button button-secondary" href={`/api/admissions/${currentPatient.id}/pdf`} target="_blank">
                  Open admissions PDF
                </a>
              </div>

              <div className="list-stack compact-top">
                {dashboard.documents.map((item) => (
                  <article key={item.id} className="line-card">
                    <strong>{item.title}</strong>
                    <span>{item.category}</span>
                    <small>{item.body}</small>
                  </article>
                ))}
              </div>
            </SectionCard>
          </>
        ) : null}

        {session.role === "nurse" ? (
          <>
            <SectionCard title="Nurse station" kicker="Ward monitoring">
              <div className="mini-metric-grid">
                <div className="mini-metric">
                  <strong>{latestVitals ? `${latestVitals.systolic}/${latestVitals.diastolic}` : "—"}</strong>
                  <span>Latest BP</span>
                </div>
                <div className="mini-metric">
                  <strong>{dashboard.medications.length}</strong>
                  <span>Medication orders</span>
                </div>
                <div className="mini-metric">
                  <strong>{activeAdministrations.length}</strong>
                  <span>Administration events</span>
                </div>
                <div className="mini-metric">
                  <strong>{dashboard.tasks.filter((item) => item.owner.includes("Naledi")).length}</strong>
                  <span>Ward tasks</span>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Record blood pressure and daily vitals" kicker="Observations" action={<button className="button button-primary" type="button" onClick={submitVitals}>Save vitals</button>}>
              <div className="form-grid form-grid-4">
                <label>
                  Systolic
                  <input value={vitalDraft.systolic} onChange={(event) => setVitalDraft({ ...vitalDraft, systolic: event.target.value })} />
                </label>
                <label>
                  Diastolic
                  <input value={vitalDraft.diastolic} onChange={(event) => setVitalDraft({ ...vitalDraft, diastolic: event.target.value })} />
                </label>
                <label>
                  Pulse
                  <input value={vitalDraft.pulse} onChange={(event) => setVitalDraft({ ...vitalDraft, pulse: event.target.value })} />
                </label>
                <label>
                  Temperature
                  <input value={vitalDraft.temperature} onChange={(event) => setVitalDraft({ ...vitalDraft, temperature: event.target.value })} />
                </label>
                <label>
                  Respiratory rate
                  <input value={vitalDraft.respiratoryRate} onChange={(event) => setVitalDraft({ ...vitalDraft, respiratoryRate: event.target.value })} />
                </label>
                <label>
                  SpO₂
                  <input value={vitalDraft.spo2} onChange={(event) => setVitalDraft({ ...vitalDraft, spo2: event.target.value })} />
                </label>
                <label>
                  Glucose
                  <input value={vitalDraft.glucose} onChange={(event) => setVitalDraft({ ...vitalDraft, glucose: event.target.value })} />
                </label>
                <label>
                  Pain score
                  <input value={vitalDraft.painScore} onChange={(event) => setVitalDraft({ ...vitalDraft, painScore: event.target.value })} />
                </label>
                <label className="full-span">
                  Notes
                  <textarea value={vitalDraft.notes} onChange={(event) => setVitalDraft({ ...vitalDraft, notes: event.target.value })} />
                </label>
              </div>

              <div className="table-shell compact-top">
                <table>
                  <thead>
                    <tr>
                      <th>Recorded</th>
                      <th>BP</th>
                      <th>Pulse</th>
                      <th>Temp</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.vitals.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDateTime(item.recordedAt)}</td>
                        <td>{item.systolic}/{item.diastolic}</td>
                        <td>{item.pulse}</td>
                        <td>{item.temperature.toFixed(1)}°C</td>
                        <td>{item.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <SectionCard title="Medication chart and administration" kicker="Nurse workflow">
              <div className="form-grid form-grid-3">
                <label>
                  Medication order
                  <select value={medAdminDraft.orderId} onChange={(event) => setMedAdminDraft({ ...medAdminDraft, orderId: event.target.value })}>
                    <option value="">Select order</option>
                    {medicationOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.drugName} {item.dose} · {item.frequency}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Status
                  <select value={medAdminDraft.status} onChange={(event) => setMedAdminDraft({ ...medAdminDraft, status: event.target.value })}>
                    <option>Given</option>
                    <option>Withheld</option>
                    <option>Missed</option>
                  </select>
                </label>
                <label>
                  Notes
                  <input value={medAdminDraft.notes} onChange={(event) => setMedAdminDraft({ ...medAdminDraft, notes: event.target.value })} />
                </label>
              </div>
              <div className="action-row">
                <button className="button button-primary" type="button" onClick={administerMedication}>Log administration</button>
              </div>

              <div className="stacked-columns compact-top">
                <div>
                  <h4>Active orders</h4>
                  <div className="list-stack">
                    {dashboard.medications.map((item) => (
                      <article key={item.id} className="line-card">
                        <strong>{item.drugName} {item.dose}</strong>
                        <span>{item.route} · {item.frequency}</span>
                        <small>{item.indication}</small>
                      </article>
                    ))}
                  </div>
                </div>

                <div>
                  <h4>Admin history</h4>
                  <div className="list-stack">
                    {dashboard.administrations.map((item) => (
                      <article key={item.id} className="line-card">
                        <strong>{item.status}</strong>
                        <span>{formatDateTime(item.administeredAt)}</span>
                        <small>{item.notes || "No note added."}</small>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Ward handover, labs, and arrivals" kicker="Shift coordination">
              <div className="stacked-columns">
                <div>
                  <h4>Latest labs</h4>
                  <div className="list-stack">
                    {dashboard.labs.map((item) => (
                      <article key={item.id} className="line-card">
                        <strong>{item.provider} · {item.testName}</strong>
                        <span>{item.abnormalFlag}</span>
                        <small>{item.resultSummary}</small>
                      </article>
                    ))}
                  </div>
                </div>

                <div>
                  <h4>Ward messages</h4>
                  <div className="list-stack">
                    {staffFilteredMessages.filter((item) => item.channel === "Ward").map((message) => (
                      <article key={message.id} className="line-card">
                        <strong>{message.authorName}</strong>
                        <span>{formatDateTime(message.createdAt)}</span>
                        <small>{message.body}</small>
                      </article>
                    ))}
                  </div>
                </div>

                <div>
                  <h4>Casualty arrivals board</h4>
                  <div className="list-stack">
                    {dashboard.arrivals.slice(0, 5).map((item) => (
                      <article key={item.id} className="line-card">
                        <strong>{item.patientName}</strong>
                        <span>{item.arrivalMode} · {item.triageColor}</span>
                        <small>{item.status}</small>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        ) : null}

        {session.role === "admin" ? (
          <>
            <SectionCard title="Admin command centre" kicker="Broad hospital operations">
              <div className="mini-metric-grid">
                <div className="mini-metric">
                  <strong>{dashboard.cases.length}</strong>
                  <span>Open cases</span>
                </div>
                <div className="mini-metric">
                  <strong>{dashboard.facilityMetrics.activeTasks}</strong>
                  <span>Open tasks</span>
                </div>
                <div className="mini-metric">
                  <strong>{dashboard.facilityMetrics.pendingEmails}</strong>
                  <span>Queued emails</span>
                </div>
                <div className="mini-metric">
                  <strong>{dashboard.facilityMetrics.theatreCasesToday}</strong>
                  <span>Theatre cases</span>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Admissions and bookings" kicker="Front office">
              <div className="form-grid form-grid-3">
                <label>
                  Department
                  <select value={appointmentDraft.department} onChange={(event) => setAppointmentDraft({ ...appointmentDraft, department: event.target.value })}>
                    {departments.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Clinician
                  <input value={appointmentDraft.clinician} onChange={(event) => setAppointmentDraft({ ...appointmentDraft, clinician: event.target.value })} />
                </label>
                <label>
                  Type
                  <select value={appointmentDraft.type} onChange={(event) => setAppointmentDraft({ ...appointmentDraft, type: event.target.value })}>
                    {appointmentTypes.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Scheduled at
                  <input type="datetime-local" value={appointmentDraft.scheduledAt} onChange={(event) => setAppointmentDraft({ ...appointmentDraft, scheduledAt: event.target.value })} />
                </label>
                <label>
                  Location
                  <input value={appointmentDraft.location} onChange={(event) => setAppointmentDraft({ ...appointmentDraft, location: event.target.value })} />
                </label>
                <label>
                  Notes
                  <input value={appointmentDraft.notes} onChange={(event) => setAppointmentDraft({ ...appointmentDraft, notes: event.target.value })} />
                </label>
              </div>
              <div className="action-row">
                <button className="button button-primary" type="button" onClick={submitAppointment}>Book appointment</button>
                <a className="button button-secondary" href={`/api/admissions/${currentPatient.id}/pdf`} target="_blank">
                  Export admissions PDF
                </a>
              </div>

              <div className="list-stack compact-top">
                {dashboard.appointments.map((item) => (
                  <article key={item.id} className="line-card">
                    <div className="line-card-row">
                      <strong>{item.type}</strong>
                      <select value={item.status} onChange={(event) => void updateAppointmentStatus(item.id, event.target.value)}>
                        {appointmentStatuses.map((status) => (
                          <option key={status}>{status}</option>
                        ))}
                      </select>
                    </div>
                    <span>{formatDateTime(item.scheduledAt)} · {item.location}</span>
                    <small>{item.clinician}</small>
                  </article>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Ambulance, casualty, and transfer intake" kicker="Movement control">
              <div className="stacked-columns">
                <div>
                  <h4>Register arrival</h4>
                  <div className="form-grid form-grid-2">
                    <label>
                      Patient name
                      <input value={arrivalDraft.patientName} onChange={(event) => setArrivalDraft({ ...arrivalDraft, patientName: event.target.value })} />
                    </label>
                    <label>
                      Arrival mode
                      <select value={arrivalDraft.arrivalMode} onChange={(event) => setArrivalDraft({ ...arrivalDraft, arrivalMode: event.target.value })}>
                        {arrivalModes.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Source
                      <input value={arrivalDraft.source} onChange={(event) => setArrivalDraft({ ...arrivalDraft, source: event.target.value })} />
                    </label>
                    <label>
                      Triage
                      <select value={arrivalDraft.triageColor} onChange={(event) => setArrivalDraft({ ...arrivalDraft, triageColor: event.target.value })}>
                        {triageLevels.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Casualty area
                      <input value={arrivalDraft.casualtyArea} onChange={(event) => setArrivalDraft({ ...arrivalDraft, casualtyArea: event.target.value })} />
                    </label>
                    <label>
                      Status
                      <input value={arrivalDraft.status} onChange={(event) => setArrivalDraft({ ...arrivalDraft, status: event.target.value })} />
                    </label>
                    <label className="full-span">
                      Handover notes
                      <textarea value={arrivalDraft.handoverNotes} onChange={(event) => setArrivalDraft({ ...arrivalDraft, handoverNotes: event.target.value })} />
                    </label>
                  </div>
                  <div className="action-row">
                    <button className="button button-primary" type="button" onClick={submitArrival}>Register arrival</button>
                  </div>
                </div>

                <div>
                  <h4>Book transfer / transport</h4>
                  <div className="form-grid form-grid-2">
                    <label>
                      Type
                      <select value={transferDraft.type} onChange={(event) => setTransferDraft({ ...transferDraft, type: event.target.value })}>
                        {transferTypes.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Source facility
                      <input value={transferDraft.sourceFacility} onChange={(event) => setTransferDraft({ ...transferDraft, sourceFacility: event.target.value })} />
                    </label>
                    <label>
                      Destination facility
                      <input value={transferDraft.destinationFacility} onChange={(event) => setTransferDraft({ ...transferDraft, destinationFacility: event.target.value })} />
                    </label>
                    <label>
                      Transport mode
                      <input value={transferDraft.transportMode} onChange={(event) => setTransferDraft({ ...transferDraft, transportMode: event.target.value })} />
                    </label>
                    <label>
                      Escort type
                      <input value={transferDraft.escortType} onChange={(event) => setTransferDraft({ ...transferDraft, escortType: event.target.value })} />
                    </label>
                    <label>
                      ETA
                      <input value={transferDraft.eta} onChange={(event) => setTransferDraft({ ...transferDraft, eta: event.target.value })} />
                    </label>
                    <label className="full-span">
                      Reason
                      <textarea value={transferDraft.reason} onChange={(event) => setTransferDraft({ ...transferDraft, reason: event.target.value })} />
                    </label>
                  </div>
                  <div className="action-row">
                    <button className="button button-primary" type="button" onClick={submitTransfer}>Save transfer</button>
                  </div>
                </div>
              </div>

              <div className="stacked-columns compact-top">
                <div>
                  <h4>Arrivals board</h4>
                  <div className="list-stack">
                    {dashboard.arrivals.map((item) => (
                      <article key={item.id} className="line-card">
                        <strong>{item.patientName}</strong>
                        <span>{item.arrivalMode} · {item.triageColor}</span>
                        <small>{item.source} · {item.status}</small>
                      </article>
                    ))}
                  </div>
                </div>

                <div>
                  <h4>Transfers</h4>
                  <div className="list-stack">
                    {dashboard.transfers.map((item) => (
                      <article key={item.id} className="line-card">
                        <strong>{item.type}</strong>
                        <span>{item.transportMode} · {item.status}</span>
                        <small>{item.sourceFacility} → {item.destinationFacility}</small>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Documents, sick notes, and email queue" kicker="Paperwork replacement">
              <div className="stacked-columns">
                <div>
                  <h4>Create document</h4>
                  <div className="form-grid form-grid-2">
                    <label>
                      Category
                      <select value={documentDraft.category} onChange={(event) => setDocumentDraft({ ...documentDraft, category: event.target.value })}>
                        {documentCategories.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Title
                      <input value={documentDraft.title} onChange={(event) => setDocumentDraft({ ...documentDraft, title: event.target.value })} />
                    </label>
                    <label className="full-span">
                      Body
                      <textarea value={documentDraft.body} onChange={(event) => setDocumentDraft({ ...documentDraft, body: event.target.value })} />
                    </label>
                  </div>
                  <div className="action-row">
                    <button className="button button-primary" type="button" onClick={submitDocument}>Save document</button>
                  </div>
                </div>

                <div>
                  <h4>Queue email</h4>
                  <div className="form-grid form-grid-2">
                    <label>
                      Recipient
                      <input value={emailDraft.recipient} onChange={(event) => setEmailDraft({ ...emailDraft, recipient: event.target.value })} />
                    </label>
                    <label>
                      Category
                      <input value={emailDraft.category} onChange={(event) => setEmailDraft({ ...emailDraft, category: event.target.value })} />
                    </label>
                    <label className="full-span">
                      Subject
                      <input value={emailDraft.subject} onChange={(event) => setEmailDraft({ ...emailDraft, subject: event.target.value })} />
                    </label>
                  </div>
                  <div className="action-row">
                    <button className="button button-primary" type="button" onClick={submitEmail}>Queue email</button>
                  </div>
                </div>
              </div>

              <div className="stacked-columns compact-top">
                <div>
                  <h4>Document register</h4>
                  <div className="list-stack">
                    {dashboard.documents.map((item) => (
                      <article key={item.id} className="line-card">
                        <strong>{item.title}</strong>
                        <span>{item.category}</span>
                        <small>{item.body}</small>
                      </article>
                    ))}
                  </div>
                </div>

                <div>
                  <h4>Email queue</h4>
                  <div className="list-stack">
                    {dashboard.emails.map((item) => (
                      <article key={item.id} className="line-card">
                        <strong>{item.subject}</strong>
                        <span>{item.status}</span>
                        <small>{item.recipient}</small>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Tasks and staff communication" kicker="Ops board">
              <div className="stacked-columns">
                <div>
                  <div className="form-grid form-grid-2">
                    <label>
                      Task title
                      <input value={taskDraft.title} onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })} />
                    </label>
                    <label>
                      Owner
                      <input value={taskDraft.owner} onChange={(event) => setTaskDraft({ ...taskDraft, owner: event.target.value })} />
                    </label>
                    <label>
                      Department
                      <select value={taskDraft.department} onChange={(event) => setTaskDraft({ ...taskDraft, department: event.target.value })}>
                        {departments.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Priority
                      <select value={taskDraft.priority} onChange={(event) => setTaskDraft({ ...taskDraft, priority: event.target.value })}>
                        {taskPriorities.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label className="full-span">
                      ETA
                      <input value={taskDraft.eta} onChange={(event) => setTaskDraft({ ...taskDraft, eta: event.target.value })} placeholder="16:30" />
                    </label>
                  </div>
                  <div className="action-row">
                    <button className="button button-primary" type="button" onClick={submitTask}>Create task</button>
                  </div>
                </div>

                <div>
                  <div className="form-grid form-grid-2">
                    <label>
                      Channel
                      <select value={messageDraft.channel} onChange={(event) => setMessageDraft({ ...messageDraft, channel: event.target.value })}>
                        {channels.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label className="full-span">
                      Message
                      <textarea value={messageDraft.body} onChange={(event) => setMessageDraft({ ...messageDraft, body: event.target.value })} />
                    </label>
                  </div>
                  <div className="action-row">
                    <button className="button button-primary" type="button" onClick={submitMessage}>Post message</button>
                  </div>
                </div>
              </div>

              <div className="stacked-columns compact-top">
                <div>
                  <h4>Task board</h4>
                  <div className="list-stack">
                    {dashboard.tasks.map((task) => (
                      <article key={task.id} className="line-card">
                        <div className="line-card-row">
                          <strong>{task.title}</strong>
                          <select value={task.status} onChange={(event) => void updateTaskStatus(task.id, event.target.value)}>
                            {taskStatuses.map((status) => (
                              <option key={status}>{status}</option>
                            ))}
                          </select>
                        </div>
                        <span>{task.department} · {task.priority}</span>
                        <small>{task.owner} · ETA {task.eta}</small>
                      </article>
                    ))}
                  </div>
                </div>

                <div>
                  <h4>Staff communication</h4>
                  <div className="list-stack">
                    {dashboard.messages.map((message) => (
                      <article key={message.id} className="line-card">
                        <strong>{message.channel} · {message.authorName}</strong>
                        <span>{formatDateTime(message.createdAt)}</span>
                        <small>{message.body}</small>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        ) : null}
      </section>
    </div>
  );
}
