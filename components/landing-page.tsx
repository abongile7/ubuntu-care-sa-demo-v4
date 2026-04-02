import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { hospitalMeta, medicalAidSchemes, provinces, staffDirectory } from "@/lib/demo-data";

const features = [
  {
    title: "Paperless hospital workflow",
    copy:
      "Admissions, casualty intake, ward observations, medication charts, radiology, lab results, theatre bookings, transport, and email-ready documents in one app."
  },
  {
    title: "Distinct role experiences",
    copy:
      "Patient, doctor, nurse, and admin users now land in clearly different workspaces tailored to what they do every day."
  },
  {
    title: "South African intake and operations",
    copy:
      "Capture SA ID, medical aid, next-of-kin, referral source, ambulance arrivals, inter-hospital transfers, POPIA consent, and ward placement."
  },
  {
    title: "Built for phones and laptops",
    copy:
      "Responsive layouts make it easy to demo on mobile, tablet, or desktop without changing the workflow."
  }
];

const roleCards = [
  {
    title: "Patient portal",
    detail: "Admission details, appointments, documents, medications, scan visibility, and lab results."
  },
  {
    title: "Doctor cockpit",
    detail: "Clinical summary, prescribe medication, review BP and vitals, labs, scans, theatre bookings, and documents."
  },
  {
    title: "Nurse station",
    detail: "Medication administration, blood pressure checks, bedside observations, handovers, and patient arrivals."
  },
  {
    title: "Admin command centre",
    detail: "Admissions completeness, ambulance/casualty arrivals, transfers, transport, funding, paperwork replacement, and email queue."
  }
];

const workflows = [
  "Casualty triage and walk-in / ambulance arrivals",
  "Inter-hospital transfer and patient transport coordination",
  "Ward observations, blood pressure charting, and medication administration",
  "Lab results intake from providers like Ampath and clinical file release",
  "Radiology scan uploads with MRI / CT / X-ray / ultrasound support",
  "Theatre bookings, pre-op notes, and sick note / referral document handling"
];

const stats = [
  { value: "4", label: "Role workspaces" },
  { value: "8+", label: "Hospital modules" },
  { value: "Mobile", label: "Responsive UI" },
  { value: "Paperless", label: "Document flow" }
];

export function LandingPage() {
  return (
    <>
      <div className="top-alert">
        <div className="shell alert-row">
          <span>
            <strong>Emergency:</strong> Call <span className="alert-pill">112</span> from a cellphone or
            <span className="alert-pill">10177</span> for ambulance support.
          </span>
          <Link href="/login">Launch live portal demo</Link>
        </div>
      </div>

      <SiteHeader />

      <main>
        <section className="hero-section">
          <div className="shell hero-grid">
            <div className="hero-copy">
              <span className="eyebrow-pill">Broad hospital operations demo · South Africa-ready</span>
              <h1>From casualty to ward, theatre, transport, radiology, labs, and admin — all in one app.</h1>
              <p className="lead">
                UbuntuCare now demos a broader paperless hospital platform with real-seeming role separation,
                mobile-friendly screens, and South African admission and transfer workflows.
              </p>

              <div className="hero-actions">
                <Link href="/login" className="button button-primary">
                  Open live demo
                </Link>
                <a href="#showcase" className="button button-secondary">
                  See hospital modules
                </a>
              </div>

              <div className="stat-grid">
                {stats.map((item) => (
                  <div className="stat-card" key={item.label}>
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>

              <div className="badge-row">
                {provinces.slice(0, 5).map((province) => (
                  <span className="soft-chip" key={province}>
                    {province}
                  </span>
                ))}
              </div>
            </div>

            <div className="surface-card hero-panel">
              <div className="hero-panel-head">
                <span className="section-kicker">Featured team</span>
                <h2>Realistic doctor and nurse profiles for the presentation</h2>
                <p>Demo portraits use remote stock headshots and should be replaced with approved hospital staff photos in production.</p>
              </div>

              <div className="staff-feature-grid">
                {staffDirectory.map((member) => (
                  <article key={member.id} className="staff-card">
                    <img src={member.image} alt={member.name} className="staff-photo" />
                    <div>
                      <strong>{member.name}</strong>
                      <span>{member.title}</span>
                      <small>
                        {member.department} · {member.specialization}
                      </small>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="shell section-stack" id="features">
          <div className="section-heading">
            <span className="section-kicker">Why it feels broader now</span>
            <h2>Designed around real hospital work, not just front-desk onboarding</h2>
          </div>

          <div className="feature-grid">
            {features.map((feature) => (
              <article key={feature.title} className="surface-card feature-card">
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="shell section-stack" id="journey">
          <div className="journey-layout">
            <div className="surface-card journey-card">
              <span className="section-kicker">Patient flow</span>
              <h2>One platform across the hospital journey</h2>
              <ol className="timeline-list">
                <li>Arrival by walk-in, ambulance, or inter-facility transfer</li>
                <li>Casualty / triage registration and ward or speciality placement</li>
                <li>Doctor orders, nurse observations, medication charting, and labs</li>
                <li>Imaging, theatre scheduling, documents, email release, and discharge planning</li>
              </ol>
            </div>

            <div className="surface-card journey-card">
              <span className="section-kicker">South African details</span>
              <h2>Operational context included</h2>
              <div className="chip-grid">
                {medicalAidSchemes.map((scheme) => (
                  <span key={scheme} className="soft-chip">
                    {scheme}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="shell section-stack" id="roles">
          <div className="section-heading">
            <span className="section-kicker">Role visibility</span>
            <h2>Each login behaves differently</h2>
          </div>

          <div className="role-grid">
            {roleCards.map((item) => (
              <article key={item.title} className="surface-card role-card">
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="shell section-stack" id="showcase">
          <div className="section-heading">
            <span className="section-kicker">Hospital modules</span>
            <h2>Broader workflows included in this version</h2>
          </div>

          <div className="showcase-layout">
            <div className="surface-card workflow-card">
              <ul className="workflow-list">
                {workflows.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="surface-card workflow-card">
              <h3 style={{ marginBottom: "0.75rem" }}>Presentation tip</h3>
              <p style={{ marginBottom: "1rem" }}>
                Start with patient login, switch to nurse for vitals and medication administration, then doctor for
                review, prescribing, scans, labs, and theatre, and finish in admin for casualty arrivals, transfers,
                transport, documents, and email queue.
              </p>
              <Link href="/login" className="button button-primary">
                Go to live login
              </Link>
            </div>
          </div>
        </section>

        <section className="shell footer-cta">
          <div className="surface-card cta-panel">
            <div>
              <span className="section-kicker">UbuntuCare</span>
              <h2>{hospitalMeta.tagline}</h2>
            </div>
            <Link href="/login" className="button button-primary">
              Login to demo
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
