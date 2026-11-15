export type PortalActor = {
  id: string;
  name: string;
  email?: string;
  role: string;
  unit?: string;
  organization?: string;
};
export type PortalContact = { id: string; name: string; role: string; organization?: string };
export type PortalEncounter = {
  id: string;
  reference: string;
  status: string;
  patientId?: string;
  patient: {
    id: string;
    userId?: string;
    fullName: string;
    facilityFileNumber: string;
    popiaConsent?: boolean;
    consentDataSharing?: boolean;
    consentTreatment?: boolean;
  };
};
export type PortalConcern = {
  id: string;
  category: string;
  body: string;
  urgency: string;
  status: string;
  version: number;
  createdById: string;
  assignedUserId?: string | null;
  createdAt: string;
  updates: {
    id: string;
    authorName: string;
    authorRole: string;
    body: string;
    status: string;
    createdAt: string;
  }[];
};
export type PortalRecordRequest = {
  id: string;
  reference: string;
  providerName: string;
  providerEmail: string;
  providerUserId?: string | null;
  purpose: string;
  scope: string;
  consentRecordedAt: string;
  expiresAt: string;
  status: string;
  version: number;
  createdById: string;
  assignedStaffId?: string | null;
  fulfilledVersionId?: string | null;
  createdAt: string;
};
export type PortalTask = {
  id: string;
  department: string;
  title: string;
  priority: string;
  status: string;
  version: number;
  assignedUserId: string;
  assigneeName?: string;
  dueAt?: string | null;
  createdAt: string;
};
export type PortalRecommendation = { title: string; detail: string; tab: string; action?: string };
export type PortalContext = {
  ok: boolean;
  session: PortalActor;
  encounters: PortalEncounter[];
  activeEncounter: PortalEncounter | null;
  contacts: PortalContact[];
  externalProviders?: { id: string; name: string; organization: string; email: string }[];
  claims?: { id: string; reference: string; status: string }[];
  departments: string[];
  organizations: { name: string; website: string; mode: string }[];
  concerns: PortalConcern[];
  recordRequests: PortalRecordRequest[];
  tasks: PortalTask[];
  notifications: {
    id: string;
    title: string;
    body: string;
    kind: string;
    readAt?: string | null;
    createdAt: string;
  }[];
  outbox: {
    id: string;
    subject: string;
    body?: string;
    recipientEmail?: string;
    category: string;
    status: string;
    createdAt: string;
  }[];
  assistant: {
    mode: string;
    summary: string;
    recommendations: PortalRecommendation[];
    limitations: string;
  };
};
export type PortalFile = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
};
export type PortalSignature = {
  id: string;
  signerId: string;
  signerName: string;
  signerRole: string;
  type: string;
  contentHash: string;
  statement: string;
  createdAt: string;
};
export type PortalDocumentVersion = {
  id: string;
  documentId: string;
  version: number;
  title: string;
  body: string;
  contentHash: string;
  status: string;
  requiresPatientSignature: boolean;
  publishedAt?: string | null;
  createdAt: string;
  createdById: string;
  files: PortalFile[];
  signatures: PortalSignature[];
};
export type PortalDocument = {
  id: string;
  encounterId: string;
  title: string;
  kind: string;
  visibility: string;
  recordRequestId?: string | null;
  createdById: string;
  versions: PortalDocumentVersion[];
  latestVersion: PortalDocumentVersion;
};
export type PortalMessage = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  body: string;
  createdAt: string;
  attachments?: PortalFile[];
};
export type PortalThread = {
  id: string;
  encounterId: string;
  type: string;
  subject: string;
  claimId?: string | null;
  recordRequestId?: string | null;
  members: PortalContact[];
  unread: number;
  lastMessage: PortalMessage | null;
  messages?: PortalMessage[];
};
export type PortalRun = (
  action: string,
  body?: Record<string, unknown>,
  success?: string
) => Promise<Record<string, unknown> | null>;
export type PortalRequest = (
  endpoint: string,
  body: Record<string, unknown> | FormData,
  success?: string
) => Promise<Record<string, unknown> | null>;
