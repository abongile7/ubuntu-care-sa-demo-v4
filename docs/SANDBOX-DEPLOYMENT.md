# Private national healthcare sandbox
The current architecture is a single-facility synthetic prototype, not national production infrastructure. The /sandbox hub unifies existing role workspaces and guides UAT. /integration-lab runs deterministic in-house scenarios for nine integration domains; no vendor APIs are connected. Do not enter real patient, ID, biometric, medical scheme or clinical information.

## Private hosted test deployment
The Render blueprint uses a paid single-instance Node service and a dedicated persistent disk. No deployment is created merely by committing the blueprint. In Render connect GitHub, select hospital-onboarding-telehealth, review costs and select the blueprint. Configure SANDBOX_ACCESS_PASSWORD with a unique random ASCII password at least 20 characters long. The outer HTTP Basic gate uses username tester and this secret; share it privately with approved testers, not in a public link or source. Inside, use the demo role accounts. Anyone with the shared gate can access all demo roles; do not use this as production authentication. Do not enable any external integration credentials. HTTPS is required for hosted calls. The startup script refuses to run without the gate and exact dedicated database path. It applies the schema at startup and seeds only if the user table is empty. Never point it at live data. Back up the disk before updates. /api/health discloses only generic availability.

Render disk docs: https://render.com/docs/disks ; Blueprint docs: https://render.com/docs/blueprint-spec. A public URL is issued by the host after a successful deployment; it is not yet known. Single-instance architecture is not suitable for national scale.

## National roadmap and gates
1. Hospital onboarding, master patient index with manual reconciliation, organization identity, multi-tenant segregation, role and care-team assignment, emergency access policy.
2. Patient-present claimed-identity verification via approved DHA/provider sandbox; no real biometric collection in the demo. Emergency care independent of verification.
3. Authorized inter-facility records and PDF fallback; receipt, patient match, provenance and transfer acknowledgement. External partner identities and consent/legal basis required.
4. Certified scheme switch, scheme coverage matrix, validated coding, eligibility, authorization, claim responses, remittances and reconciliation.
5. EMS, pathology, radiology/PACS, pharmacy, theatre, beds, inventory, finance, signature, notifications and telephony integration with documented contracts, synthetic test accounts and negative scenarios.
6. Production: encrypted managed database, per-tenant storage, high availability, credential vault, MFA, monitoring, comprehensive audit, privacy impact assessment, clinical governance, recovery, penetration testing and formal approvals. No claim of certification or POPIA compliance.
