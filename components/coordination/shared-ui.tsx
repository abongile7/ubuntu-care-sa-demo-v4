"use client";

import {
  cloneElement,
  isValidElement,
  useId,
  type FormEvent,
  type ReactElement,
  type ReactNode
} from "react";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="pp-field">
      <label htmlFor={id}>{label}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id: string }>, { id })
        : children}
    </div>
  );
}
export function Card({
  title,
  eyebrow,
  children
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <section className="pp-card">
      <div className="pp-card-heading">
        {eyebrow && <span className="pp-eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
export function Badge({ value }: { value: string }) {
  return <span className={`pp-badge pp-status-${value.toLowerCase()}`}>{readable(value)}</span>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="pp-empty">{children}</p>;
}
export function readable(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
export function formatTime(value?: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-ZA", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Africa/Johannesburg"
      }).format(date);
}
export function formValues(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
}
export function FileLinks({
  files
}: {
  files: { id: string; originalName: string; size: number }[];
}) {
  return files.length ? (
    <ul className="pp-files">
      {files.map((file) => (
        <li key={file.id}>
          <a href={`/api/portal/files/${encodeURIComponent(file.id)}`}>{file.originalName}</a>{" "}
          <small>{Math.ceil(file.size / 1024)} KB · protected download</small>
        </li>
      ))}
    </ul>
  ) : null;
}
