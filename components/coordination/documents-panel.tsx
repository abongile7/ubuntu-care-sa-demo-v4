"use client";

import { useEffect, useRef, useState } from "react";
import type {
  PortalActor,
  PortalDocument,
  PortalRecordRequest,
  PortalRequest
} from "@/lib/portal-types";
import {
  Badge,
  Card,
  Empty,
  Field,
  FileLinks,
  formatTime,
  formValues,
  readable
} from "./shared-ui";

export function DocumentsPanel({
  encounterId,
  actor,
  claims,
  recordRequests,
  request,
  busy
}: {
  encounterId: string;
  actor: PortalActor;
  claims: { id: string; reference: string; status: string }[];
  recordRequests: PortalRecordRequest[];
  request: PortalRequest;
  busy: boolean;
}) {
  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [visibility, setVisibility] = useState(
    actor.role === "referring_doctor"
      ? "RECORD_REQUEST"
      : actor.role === "patient"
        ? "PATIENT"
        : actor.role === "billing"
          ? "CLAIM"
          : actor.role === "paramedic"
            ? "HANDOVER"
            : "PATIENT"
  );
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const hospital = ["admin", "doctor", "nurse"].includes(actor.role);
  const author = hospital || ["patient", "referring_doctor", "billing"].includes(actor.role);
  const ownRequests = recordRequests.filter(
    (item) =>
      !["CANCELLED", "REVIEWED"].includes(item.status) &&
      new Date(item.expiresAt).getTime() > Date.now() &&
      (actor.role !== "referring_doctor" || item.providerUserId === actor.id)
  );

  async function load(preferId?: string) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const token = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/portal/documents?encounterId=${encodeURIComponent(encounterId)}`,
        { cache: "no-store", signal: abort.signal }
      );
      const result = await response.json();
      if (token !== sequence.current) return;
      if (!response.ok || !result.ok)
        throw new Error(result.message || "Documents could not be loaded.");
      setDocuments(result.documents);
      setSelectedId((current) =>
        result.documents.some((item: PortalDocument) => item.id === (preferId ?? current))
          ? (preferId ?? current)
          : (result.documents[0]?.id ?? "")
      );
    } catch (reason) {
      if (!abort.signal.aborted && token === sequence.current)
        setError(reason instanceof Error ? reason.message : "Documents could not be loaded.");
    } finally {
      if (token === sequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
      controller.current?.abort();
    };
    // Recreate the panel for a new authenticated encounter scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounterId]);

  const document = documents.find((item) => item.id === selectedId);
  const version =
    document?.versions.find((item) => item.id === versionId) ?? document?.latestVersion;
  const editable =
    !!document && (hospital || document.createdById === actor.id) && actor.role !== "insurer";
  const signed = version?.signatures.some((signature) => signature.signerId === actor.id);
  const locked = busy || loading;
  const visibilities = hospital
    ? ["PATIENT", "INTERNAL", "CLAIM", "HANDOVER", "RECORD_REQUEST"]
    : [visibility];

  return (
    <div className="pp-stack">
      <div className="pp-toolbar">
        <p className="pp-muted">
          Versioned records, protected attachments and typed acknowledgements.
        </p>
        {author && (
          <button type="button" disabled={locked} onClick={() => setShowCreate((value) => !value)}>
            {showCreate ? "Close new document" : "+ New document"}
          </button>
        )}
      </div>
      {showCreate && (
        <Card title="Create a draft document" eyebrow="PUBLISH WHEN READY">
          <form
            className="pp-form"
            onSubmit={async (event) => {
              const values = formValues(event);
              const result = await request(
                "/api/portal/documents",
                {
                  action: "create",
                  title: values.title,
                  kind: values.kind,
                  visibility: values.visibility,
                  body: values.body,
                  requiresPatientSignature: values.requiresPatientSignature === "on",
                  ...(visibility === "RECORD_REQUEST"
                    ? { recordRequestId: values.recordRequestId }
                    : {}),
                  ...(visibility === "CLAIM" ? { claimId: values.claimId } : {})
                },
                "Draft document created. Attach files before publishing."
              );
              if (result) {
                setShowCreate(false);
                setVersionId("");
                await load(String(result.documentId));
              }
            }}
          >
            <div className="pp-form-grid">
              <Field label="Document title">
                <input name="title" required maxLength={160} />
              </Field>
              <Field label="Document type">
                <select
                  name="kind"
                  defaultValue={
                    actor.role === "patient"
                      ? "PATIENT_UPLOAD"
                      : actor.role === "referring_doctor"
                        ? "RECORD_REQUEST"
                        : actor.role === "billing"
                          ? "CLAIM_SUPPORT"
                          : "PATIENT_INFORMATION"
                  }
                >
                  {(hospital
                    ? [
                        "PATIENT_INFORMATION",
                        "CLINICAL_NOTE",
                        "CONSENT",
                        "DISCHARGE_SUMMARY",
                        "RECORD_REQUEST",
                        "CLAIM_SUPPORT",
                        "HANDOVER"
                      ]
                    : [
                        actor.role === "patient"
                          ? "PATIENT_UPLOAD"
                          : actor.role === "referring_doctor"
                            ? "RECORD_REQUEST"
                            : "CLAIM_SUPPORT"
                      ]
                  ).map((kind) => (
                    <option key={kind} value={kind}>
                      {readable(kind)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Who can access this document?">
                <select
                  name="visibility"
                  value={visibility}
                  onChange={(event) => setVisibility(event.target.value)}
                >
                  {visibilities.map((value) => (
                    <option key={value} value={value}>
                      {readable(value)}
                    </option>
                  ))}
                </select>
              </Field>
              {visibility === "RECORD_REQUEST" && (
                <Field label="Prior-record request">
                  <select name="recordRequestId" required>
                    <option value="">Select the consented request</option>
                    {ownRequests.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.reference} · {item.providerName}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {visibility === "CLAIM" && (
                <Field label="Linked claim">
                  <select name="claimId" required>
                    <option value="">Select the claim</option>
                    {claims.map((claim) => (
                      <option key={claim.id} value={claim.id}>
                        {claim.reference} · {readable(claim.status)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            <Field label="Document text">
              <textarea name="body" required maxLength={50000} rows={5} />
            </Field>
            {hospital && (
              <label className="pp-check">
                <input type="checkbox" name="requiresPatientSignature" />
                Request a patient typed acknowledgement
              </label>
            )}
            <p className="pp-help">
              A draft is editable through a new version. Publishing fixes its text, files and
              content hash.
            </p>
            {visibility === "CLAIM" && !claims.length && (
              <p className="pp-warning">No accessible claim is available for a claim document.</p>
            )}
            <button
              type="submit"
              disabled={
                locked ||
                (visibility === "RECORD_REQUEST" && !ownRequests.length) ||
                (visibility === "CLAIM" && !claims.length)
              }
            >
              Create draft
            </button>
          </form>
        </Card>
      )}
      {loading && (
        <p role="status" className="pp-loading">
          Loading accessible documents…
        </p>
      )}
      {error && (
        <div role="alert" className="pp-notice pp-error">
          {error}
          <button type="button" className="pp-subtle" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {!loading && !error && !documents.length && (
        <Card title="Documents">
          <Empty>
            No documents are available in your current sharing scope. Create a draft or ask the care
            team to publish a patient document.
          </Empty>
        </Card>
      )}
      {!!documents.length && (
        <div className="pp-document-layout">
          <aside className="pp-card pp-record-list" aria-label="Document list">
            <h2>
              Documents <span className="pp-count">{documents.length}</span>
            </h2>
            {documents.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === selectedId ? "pp-selected" : ""}
                disabled={locked}
                onClick={() => {
                  setSelectedId(item.id);
                  setVersionId("");
                }}
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {readable(item.kind)} · {readable(item.visibility)}
                  </small>
                </span>
                <span>
                  <Badge value={item.latestVersion.status} />
                  <small>Version {item.latestVersion.version}</small>
                </span>
              </button>
            ))}
          </aside>
          {document && version && (
            <div className="pp-stack">
              <Card
                title={version.title}
                eyebrow={`${readable(document.visibility)} · ${readable(document.kind)}`}
              >
                <div className="pp-document-meta">
                  <div className="pp-inline">
                    <Badge value={version.status} />
                    <span>Version {version.version}</span>
                    <span>{formatTime(version.publishedAt ?? version.createdAt)}</span>
                  </div>
                  <Field label="Document version">
                    <select
                      value={version.id}
                      disabled={locked}
                      onChange={(event) => setVersionId(event.target.value)}
                    >
                      {document.versions.map((item) => (
                        <option key={item.id} value={item.id}>
                          Version {item.version} · {readable(item.status)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="pp-document-body">{version.body}</div>
                <FileLinks files={version.files} />
                <div className="pp-actions">
                  <a
                    className="pp-link-button"
                    href={`/api/portal/documents/${encodeURIComponent(version.id)}/print`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Print / save PDF ↗
                  </a>
                  {editable && version.status === "DRAFT" && (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={async () => {
                        const result = await request(
                          "/api/portal/documents",
                          { action: "publish", versionId: version.id },
                          "Document published. This version is now immutable."
                        );
                        if (result) await load(document.id);
                      }}
                    >
                      Publish version {version.version}
                    </button>
                  )}
                </div>
                <details className="pp-integrity">
                  <summary>Version integrity & acknowledgements</summary>
                  <p>Content hash binds this exact text and its attached file digests.</p>
                  <code>{version.contentHash}</code>
                  <small>Version ID: {version.id}</small>
                  {version.signatures.length ? (
                    <ul>
                      {version.signatures.map((signature) => (
                        <li key={signature.id}>
                          <strong>{signature.signerName}</strong> · {readable(signature.signerRole)}
                          <br />
                          {signature.statement}
                          <br />
                          <small>
                            {formatTime(signature.createdAt)} · {readable(signature.type)}
                          </small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No typed acknowledgements recorded for this version.</p>
                  )}
                </details>
              </Card>
              {editable && version.status === "DRAFT" && (
                <Card title="Attach a file to this draft" eyebrow="PROTECTED BLOB STORAGE">
                  <form
                    className="pp-form"
                    key={`file-${version.id}`}
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const body = new FormData(form);
                      const file = body.get("file");
                      if (file instanceof File && file.size > 5 * 1024 * 1024) {
                        setError("Choose a file of 5 MB or less.");
                        return;
                      }
                      body.set("versionId", version.id);
                      const result = await request(
                        "/api/portal/files",
                        body,
                        "File attached to the draft."
                      );
                      if (result) {
                        form.reset();
                        await load(document.id);
                      }
                    }}
                  >
                    <Field label="PDF, PNG, JPEG or UTF-8 text · maximum 5 MB">
                      <input
                        type="file"
                        name="file"
                        required
                        accept="application/pdf,image/png,image/jpeg,text/plain"
                      />
                    </Field>
                    <button type="submit" disabled={locked}>
                      Upload attachment
                    </button>
                  </form>
                  <p className="pp-help">
                    Publish after all attachments have been added. Published files cannot be
                    replaced.
                  </p>
                </Card>
              )}
              {version.status === "PUBLISHED" &&
                (hospital || actor.role === "patient") &&
                !signed && (
                  <Card
                    title={
                      version.requiresPatientSignature
                        ? "Acknowledgement requested"
                        : "Acknowledge this version"
                    }
                    eyebrow="DEMO TYPED ACKNOWLEDGEMENT"
                  >
                    <form
                      className="pp-form"
                      key={`sign-${version.id}`}
                      onSubmit={async (event) => {
                        const values = formValues(event);
                        const result = await request(
                          "/api/portal/documents",
                          {
                            action: "sign",
                            versionId: version.id,
                            typedName: values.typedName,
                            acknowledged: values.acknowledged === "on"
                          },
                          "Your acknowledgement was bound to this exact document version."
                        );
                        if (result) await load(document.id);
                      }}
                    >
                      <p>
                        You are acknowledging version {version.version}, including its attached
                        files. This demo records your account, name, time and content hash.
                      </p>
                      <Field label={`Type your account name: ${actor.name}`}>
                        <input name="typedName" required autoComplete="name" maxLength={160} />
                      </Field>
                      <label className="pp-check">
                        <input name="acknowledged" type="checkbox" required />I have read this
                        version and acknowledge its contents.
                      </label>
                      <button type="submit" disabled={locked}>
                        Record typed acknowledgement
                      </button>
                    </form>
                    <p className="pp-help">
                      This feature does not establish that a particular legal signature requirement
                      has been met.
                    </p>
                  </Card>
                )}
              {signed && (
                <p className="pp-notice pp-success" role="status">
                  You have acknowledged this exact version.
                </p>
              )}
              {editable && (
                <details className="pp-new-version">
                  <summary>Create a new document version</summary>
                  <form
                    className="pp-form"
                    key={`version-${version.id}`}
                    onSubmit={async (event) => {
                      const values = formValues(event);
                      const result = await request(
                        "/api/portal/documents",
                        {
                          action: "newVersion",
                          documentId: document.id,
                          title: values.title,
                          body: values.body,
                          requiresPatientSignature: values.requiresPatientSignature === "on"
                        },
                        "New draft version created. Earlier versions are preserved."
                      );
                      if (result) {
                        setVersionId(String(result.versionId));
                        await load(document.id);
                      }
                    }}
                  >
                    <Field label="Title for the new version">
                      <input name="title" required maxLength={160} defaultValue={version.title} />
                    </Field>
                    <Field label="Text for the new version">
                      <textarea
                        name="body"
                        required
                        maxLength={50000}
                        rows={5}
                        defaultValue={version.body}
                      />
                    </Field>
                    {hospital && (
                      <label className="pp-check">
                        <input
                          name="requiresPatientSignature"
                          type="checkbox"
                          defaultChecked={version.requiresPatientSignature}
                        />
                        Request patient acknowledgement
                      </label>
                    )}
                    <p className="pp-help">
                      Files belong to one version. Upload the files needed for the new draft before
                      publishing.
                    </p>
                    <button type="submit" disabled={locked}>
                      Create next draft version
                    </button>
                  </form>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
