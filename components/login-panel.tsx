"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const quickLogins = [
  {
    label: "Patient view",
    email: "patient@ubuntucare.demo",
    password: "Demo123!",
    accent: "patient",
    detail: "Onboarding, appointments, scan view, and updates"
  },
  {
    label: "Doctor view",
    email: "doctor@ubuntucare.demo",
    password: "Demo123!",
    accent: "doctor",
    detail: "Clinical cockpit, imaging, scheduling, and staff comms"
  },
  {
    label: "Nurse view",
    email: "nurse@ubuntucare.demo",
    password: "Demo123!",
    accent: "nurse",
    detail: "Ward coordination, handover tasks, and readiness"
  },
  {
    label: "Admin view",
    email: "admin@ubuntucare.demo",
    password: "Demo123!",
    accent: "admin",
    detail: "Admissions verification, funding, and exports"
  }
];

export function LoginPanel() {
  const router = useRouter();
  const [email, setEmail] = useState("patient@ubuntucare.demo");
  const [password, setPassword] = useState("Demo123!");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submitLogin(currentEmail: string, currentPassword: string) {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: currentEmail,
          password: currentPassword
        })
      });

      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
      };

      if (!response.ok || !payload.ok) {
        setMessage(payload.message ?? "Unable to sign in.");
        setLoading(false);
        return;
      }

      router.push("/portal");
      router.refresh();
    } catch {
      setMessage("Network error while signing in.");
      setLoading(false);
      return;
    }

    setLoading(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitLogin(email, password);
  }

  return (
    <div className="login-layout">
      <section className="surface-card login-copy">
        <span className="section-kicker">Live presentation access</span>
        <h1>Sign in to the UbuntuCare SA portal</h1>
        <p>
          Each seeded role opens a visibly different workspace with its own colour accents, actions, and hospital
          priorities. Use the quick cards below during the presentation for instant switching.
        </p>

        <div className="quick-login-grid">
          {quickLogins.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`quick-login-card ${item.accent}`}
              onClick={() => {
                setEmail(item.email);
                setPassword(item.password);
                void submitLogin(item.email, item.password);
              }}
              disabled={loading}
            >
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
              <small>
                {item.email} · {item.password}
              </small>
            </button>
          ))}
        </div>

        <div className="security-note">
          <div className="icon-box">◎</div>
          <div>
            <strong>Persistent auth and seeded database</strong>
            <p>
              Sessions are stored in SQLite and delivered through an HTTP-only cookie. Profile edits, bookings,
              messages, tasks, and MRI uploads stay available until you reset the demo database.
            </p>
          </div>
        </div>
      </section>

      <section className="surface-card login-form-shell">
        <div className="form-head">
          <span className="section-kicker">Manual login</span>
          <h2>Credentials are prefilled</h2>
          <p>Use any of the demo accounts or type them manually.</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              autoComplete="username"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="patient@ubuntucare.demo"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Demo123!"
              required
            />
          </label>

          <button type="submit" className="button button-primary" disabled={loading}>
            {loading ? "Signing in..." : "Sign in to portal"}
          </button>

          {message ? <p className="form-message error-text">{message}</p> : null}
        </form>

        <div className="login-visual">
          <img src="/landing-clinical.svg" alt="Hospital dashboard artwork" />
        </div>
      </section>
    </div>
  );
}
