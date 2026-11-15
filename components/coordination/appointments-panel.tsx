"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { PortalActor } from "@/lib/portal-types";
import { portalDepartments } from "@/lib/portal-constants";
import { Badge, Card, Empty, Field, formatTime, readable } from "./shared-ui";
import { VideoCall } from "./video-call";

type Appointment = {
  id: string;
  reference: string;
  title: string;
  department: string;
  startsAt: string;
  endsAt: string;
  status: string;
  mode: string;
  version: number;
  clinicianId: string;
  patientInstructions: string;
  clinician: { id: string; name: string; role: string } | null;
  videoRoom: { id: string; status: string } | null;
};
type Reminder = {
  id: string;
  appointmentId: string | null;
  channel: string;
  dueAt: string;
  status: string;
};
type AppointmentData = {
  ok: boolean;
  message?: string;
  appointments: Appointment[];
  clinicians: { id: string; name: string; role: string }[];
  reminders: Reminder[];
};
const dayInSast = (date: string | Date) =>
  new Date(new Date(date).getTime() + 2 * 3_600_000).toISOString().slice(0, 10);
const defaultStart = () => `${dayInSast(new Date(Date.now() + 24 * 3_600_000))}T10:00`;

export function AppointmentsPanel({
  encounterId,
  actor,
  onBusyChange
}: {
  encounterId: string;
  actor: PortalActor;
  onBusyChange?: (busy: boolean) => void;
}) {
  const allowed = ["patient", "admin", "doctor", "nurse"].includes(actor.role);
  const staff = ["admin", "doctor", "nurse"].includes(actor.role);
  const [data, setData] = useState<AppointmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [callBusy, setCallBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [month, setMonth] = useState(() => dayInSast(new Date()).slice(0, 7));
  const [activeVideo, setActiveVideo] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [endsAt, setEndsAt] = useState(() => `${defaultStart().slice(0, 11)}10:30`);
  const loadGeneration = useRef(0);
  const mounted = useRef(true);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;

  useEffect(() => {
    busyCallback.current?.(busy || callBusy);
  }, [busy, callBusy]);
  useEffect(
    () => () => {
      busyCallback.current?.(false);
    },
    []
  );
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!allowed) {
        setLoading(false);
        return;
      }
      const attempt = ++loadGeneration.current;
      setLoading(true);
      try {
        const response = await fetch(
          `/api/portal/appointments?encounterId=${encodeURIComponent(encounterId)}`,
          { cache: "no-store", signal }
        );
        const result = (await response.json()) as AppointmentData;
        if (!response.ok || !result.ok)
          throw new Error(result.message ?? "Unable to load appointments.");
        if (mounted.current && attempt === loadGeneration.current) {
          setData(result);
          setError("");
        }
      } catch (failure) {
        if (
          mounted.current &&
          attempt === loadGeneration.current &&
          !(failure instanceof DOMException && failure.name === "AbortError")
        )
          setError(failure instanceof Error ? failure.message : "Unable to load appointments.");
      } finally {
        if (mounted.current && attempt === loadGeneration.current) setLoading(false);
      }
    },
    [allowed, encounterId]
  );
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    setData(null);
    setMessage("");
    setError("");
    setActiveVideo(null);
    setSelectedDay(null);
    void load(controller.signal);
    return () => {
      mounted.current = false;
      loadGeneration.current++;
      controller.abort();
    };
  }, [load]);

  async function mutate(body: Record<string, unknown>, success: string) {
    if (busy || callBusy) return;
    busyCallback.current?.(true);
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/portal/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = (await response.json()) as {
        ok: boolean;
        message?: string;
        processed?: number;
      };
      if (!response.ok || !result.ok)
        throw new Error(result.message ?? "Unable to update the appointment.");
      if (mounted.current) {
        setMessage(
          body.action === "runReminders"
            ? `Processed ${result.processed ?? 0} due reminders. Email copies remain simulated.`
            : success
        );
        await load();
      }
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : "Unable to update the appointment.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget).entries());
    void mutate(
      {
        ...fields,
        action: "create",
        encounterId,
        startsAt: `${startsAt}:00+02:00`,
        endsAt: `${endsAt}:00+02:00`
      },
      actor.role === "patient"
        ? "Appointment requested. Hospital staff will confirm the time."
        : "Appointment confirmed. Durable reminders have been scheduled."
    );
  }

  if (!allowed)
    return (
      <Card title="Appointments">
        <Empty>Appointments are available to the patient and hospital care team.</Empty>
      </Card>
    );
  const [yearNumber, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(Date.UTC(yearNumber, monthNumber - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(yearNumber, monthNumber, 0)).getUTCDate();
  const appointments = data?.appointments ?? [];
  const visible = selectedDay
    ? appointments.filter((appointment) => dayInSast(appointment.startsAt) === selectedDay)
    : appointments;
  const moveMonth = (offset: number) => {
    const next = new Date(Date.UTC(yearNumber, monthNumber - 1 + offset, 1));
    setMonth(next.toISOString().slice(0, 7));
    setSelectedDay(null);
  };
  const locked = busy || callBusy;

  return (
    <div className="pp-stack">
      {error && (
        <p className="pp-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="pp-notice" role="status">
          {message}
        </p>
      )}
      <Card title="Calendar and appointments" eyebrow="South African Standard Time · UTC+02:00">
        <p>
          Request a visit or meet by video. The hospital confirms requested appointments. Calendar
          downloads contain a generic appointment label.
        </p>
        <div
          className="pp-actions"
          style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
        >
          <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}>
            ←
          </button>
          <strong>
            {new Intl.DateTimeFormat("en-ZA", {
              month: "long",
              year: "numeric",
              timeZone: "UTC"
            }).format(new Date(`${month}-01T00:00:00Z`))}
          </strong>
          <button type="button" aria-label="Next month" onClick={() => moveMonth(1)}>
            →
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedDay(null);
              setMonth(dayInSast(new Date()).slice(0, 7));
            }}
          >
            All appointments
          </button>
          <button type="button" disabled={locked || loading} onClick={() => void load()}>
            Refresh appointments
          </button>
        </div>
        <div
          role="group"
          aria-label="Appointment calendar"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7,minmax(0,1fr))",
            gap: 3,
            margin: "16px 0",
            width: "100%"
          }}
        >
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <small key={day} style={{ textAlign: "center", padding: 4 }}>
              {day}
            </small>
          ))}
          {Array.from({ length: firstDay }, (_, index) => (
            <span key={`empty-${index}`} />
          ))}
          {Array.from({ length: dayCount }, (_, index) => {
            const day = `${month}-${String(index + 1).padStart(2, "0")}`;
            const count = appointments.filter(
              (appointment) =>
                dayInSast(appointment.startsAt) === day && appointment.status !== "CANCELLED"
            ).length;
            return (
              <button
                key={day}
                type="button"
                aria-pressed={selectedDay === day}
                aria-label={`${day}${count ? `, ${count} appointments` : ""}`}
                onClick={() => setSelectedDay(day)}
                style={{
                  minWidth: 0,
                  minHeight: 48,
                  padding: "5px 1px",
                  background: selectedDay === day ? "#e0f3ef" : undefined,
                  color: selectedDay === day ? "#123c35" : undefined,
                  border: day === dayInSast(new Date()) ? "2px solid #2f8379" : undefined
                }}
              >
                <span>{index + 1}</span>
                {count > 0 && (
                  <small style={{ display: "block", fontSize: 10 }}>
                    {count} visit{count === 1 ? "" : "s"}
                  </small>
                )}
              </button>
            );
          })}
        </div>
        {loading && <p role="status">Loading appointments…</p>}
        {selectedDay && (
          <p>
            Appointments on {selectedDay}{" "}
            <button type="button" onClick={() => setSelectedDay(null)}>
              Show all
            </button>
          </p>
        )}
        {!loading && visible.length === 0 && (
          <Empty>
            No appointments {selectedDay ? "on this day" : "yet"}. Request a suitable time below.
          </Empty>
        )}
        <div className="pp-stack">
          {visible.map((appointment) => {
            const future = new Date(appointment.startsAt).getTime() > Date.now();
            const cancellable = future && ["REQUESTED", "CONFIRMED"].includes(appointment.status);
            const canVideo =
              appointment.mode === "VIDEO" &&
              appointment.status === "CONFIRMED" &&
              appointment.videoRoom?.status !== "ENDED" &&
              (actor.role === "patient" || actor.id === appointment.clinicianId);
            return (
              <article
                className="pp-item"
                key={appointment.id}
                style={{ border: "1px solid #dbe6e4", borderRadius: 12, padding: 16 }}
              >
                <div
                  className="pp-actions"
                  style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
                >
                  <strong>{appointment.title}</strong>
                  <Badge value={appointment.status} />
                  <Badge value={appointment.mode} />
                </div>
                <p>
                  {formatTime(appointment.startsAt)} –{" "}
                  {new Intl.DateTimeFormat("en-ZA", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Africa/Johannesburg"
                  }).format(new Date(appointment.endsAt))}{" "}
                  SAST
                  <br />
                  {appointment.department} · {appointment.clinician?.name ?? "Assigned clinician"}
                </p>
                {appointment.patientInstructions && <p>{appointment.patientInstructions}</p>}
                <small>
                  {appointment.reference} · Version {appointment.version}
                </small>
                <div
                  className="pp-actions"
                  style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}
                >
                  <a
                    href={`/api/portal/appointments/${encodeURIComponent(appointment.id)}/calendar`}
                  >
                    Download calendar (.ics)
                  </a>
                  {staff && future && appointment.status === "REQUESTED" && (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() =>
                        void mutate(
                          {
                            action: "confirm",
                            appointmentId: appointment.id,
                            version: appointment.version
                          },
                          "Appointment confirmed. Reminders scheduled."
                        )
                      }
                    >
                      Confirm appointment
                    </button>
                  )}
                  {cancellable && (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() =>
                        void mutate(
                          {
                            action: "cancel",
                            appointmentId: appointment.id,
                            version: appointment.version
                          },
                          "Appointment cancelled. Pending reminders stopped."
                        )
                      }
                    >
                      Cancel appointment
                    </button>
                  )}
                  {canVideo && activeVideo !== appointment.id && (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => setActiveVideo(appointment.id)}
                    >
                      Open video appointment
                    </button>
                  )}
                  {appointment.videoRoom?.status === "ENDED" && <span>Video call ended</span>}
                </div>
                {activeVideo === appointment.id && (
                  <VideoCall
                    key={appointment.id}
                    appointmentId={appointment.id}
                    onBusyChange={setCallBusy}
                    onEnded={() => void load()}
                  />
                )}
              </article>
            );
          })}
        </div>
      </Card>
      <Card title={actor.role === "patient" ? "Request an appointment" : "Book an appointment"}>
        <form onSubmit={create}>
          <fieldset
            disabled={locked || loading}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <div className="pp-form-grid">
              <Field label="Appointment title">
                <input
                  name="title"
                  required
                  maxLength={160}
                  defaultValue="Follow-up consultation"
                />
              </Field>
              <Field label="Department">
                <select name="department" required defaultValue="General Medicine">
                  {portalDepartments.map((department) => (
                    <option key={department}>{department}</option>
                  ))}
                </select>
              </Field>
              <Field label="Clinician">
                <select name="clinicianId" required defaultValue="">
                  <option value="" disabled>
                    Select a doctor or nurse
                  </option>
                  {data?.clinicians.map((clinician) => (
                    <option key={clinician.id} value={clinician.id}>
                      {clinician.name} · {readable(clinician.role)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Visit format">
                <select name="mode" defaultValue="ONSITE">
                  <option value="ONSITE">At the hospital</option>
                  <option value="VIDEO">Private video call</option>
                </select>
              </Field>
              <Field label="Start time (SAST, UTC+02:00)">
                <input
                  type="datetime-local"
                  required
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                />
              </Field>
              <Field label="End time (SAST, UTC+02:00)">
                <input
                  type="datetime-local"
                  required
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                />
              </Field>
              <Field label="Patient instructions (optional)">
                <textarea name="patientInstructions" maxLength={2000} rows={3} />
              </Field>
            </div>
            <button type="submit">
              {busy
                ? "Saving…"
                : actor.role === "patient"
                  ? "Request appointment"
                  : "Confirm booking"}
            </button>
          </fieldset>
        </form>
        <p className="pp-muted">
          Confirmed appointments schedule in-app and simulated email reminders 24 hours and 1 hour
          before the visit. No external invitations or emails are sent.
        </p>
      </Card>
      <Card title="Your reminders">
        {data?.reminders.length ? (
          <ul>
            {data.reminders.map((reminder) => (
              <li key={reminder.id}>
                {formatTime(reminder.dueAt)} ·{" "}
                {reminder.channel === "EMAIL" ? "Email simulation" : "In-app"} ·{" "}
                {readable(reminder.status)}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No reminders for your account yet.</Empty>
        )}
        {actor.role === "admin" && (
          <button
            type="button"
            disabled={locked}
            onClick={() => void mutate({ action: "runReminders" }, "Reminders processed.")}
          >
            Process due reminders
          </button>
        )}
      </Card>
    </div>
  );
}
