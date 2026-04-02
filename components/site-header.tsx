import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="shell nav-shell">
        <Link href="/" className="brand">
          <span className="brand-mark">✚</span>
          <span>
            <strong>UbuntuCare Private Hospital</strong>
            <small>Johannesburg · South African demo portal</small>
          </span>
        </Link>

        <nav className="nav-links" aria-label="Primary">
          <a href="#features">Features</a>
          <a href="#journey">Journey</a>
          <a href="#roles">Roles</a>
          <a href="#showcase">Showcase</a>
        </nav>

        <div className="nav-actions">
          <Link className="button button-secondary" href="/portal">
            Open portal
          </Link>
          <Link className="button button-primary" href="/login">
            Login demo
          </Link>
        </div>
      </div>
    </header>
  );
}
