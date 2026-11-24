# UbuntuCare SA: paperless workflow research and demo

## Benchmark and design rationale
- Netcare online pre-admission and profile management: https://www.netcare.co.za/netcare-hospitals/patient-information/hospital-pre-admission
- Mediclinic online pre-admission and consent: https://forms.mediclinic.co.za/ and https://forms.mediclinic.co.za/PatientBooking/content/docs/Mediclinic_Terms_and_Conditions.htm
- Life Healthcare pre-admission requirements and medical scheme authorisation: https://www.lifehealthcare.co.za/patient-information/going-into-hospital/pre-admission/what-you-need-for-pre-admission/
- Healthbridge EHR and electronic remittance matching: https://healthbridge.co.za/healthbridge-clinical/ and https://help.healthbridgenova.co.za/en/article/how-to-manage-electronic-remittances-eras
- HPCSA updated informed consent and recordkeeping guidelines: https://www.hpcsa-blogs.co.za/new-and-updated-ethical-guidelines/
- ECTA: https://www.gov.za/documents/electronic-communications-and-transactions-act
- Medical Schemes general regulations: https://www.acts.co.za/medical-schemes-act-1998/r1262_5__accounts_by_suppliers_of_services
- National Health Act: https://lawlibrary.org.za/akn/za/act/2003/61/eng%402014-09-01

## Demonstration
Use fictional records only. On the existing telehealth branch, back up the demo database, then npm run db:push (or npm run db:setup on a disposable database) and npm run dev. Open /paperless after login, or use the navigation in /journey.
1. Patient submits planned pre-admission after onboarding privacy consent. Admin reviews and records fictional authorisation if applicable. Administrative readiness is not a clinical admission or insurance guarantee. Cancel and submit a corrected request if information is required.
2. Admissions issues admission or privacy forms; billing issues financial agreement; doctor issues treatment/procedure/referral/discharge forms. Complete all placeholders with synthetic text. Patient and admissions can upload synthetic PDFs (2 MiB).
3. Patient opens own issued document; for procedure and treatment, the issuing doctor signs first. Signing requires account password confirmation, intent and exact content hash. Issuer can void and reissue; history is retained. PDF evidence contains signer names, timestamps and content hash. Not a certificate-based PDF signature or accredited advanced electronic signature. A signature does not establish that informed consent was legally/clinically valid; no treatment consent flag is automatically changed by signing. Actual consent forms and authority/guardian workflows need hospital approval.
4. Finance uses /journey for existing simulated eligibility/authorisation, ICD-10 diagnosis, invoice, validation, claim submission, insurer review and corrections. Approved claim can receive simulated partial/full remittances in /paperless. References are unique and overpayment is blocked. Full allocation changes claim to paid; partial leaves it approved. No automatic assignment of shortfall to patient, external switch connection, electronic remittance import, real payment or certified claim format. Existing legacy payment simulator remains for claims without remittances.
5. Role isolation, document download permissions, signature ordering, duplicates and remittance validation are covered in HTTP integration tests. Existing staff access is single-facility demo scope, not production clinician assignment.

## Production gates
- Apply approved hospital forms, patient identity and capacity/guardian checks, appropriate signature method under ECTA (advanced electronic signature where law requires), legally reviewed consent/withdrawal process and full audit/retention policy. SHA-256 evidence is not proof against privileged database manipulation.
- Replace SQLite demo storage with encrypted managed database/object storage, malware scanning and safe upload handling; PDF magic byte check is not malware scanning. Add MFA, rate limits, facility tenancy, care-team assignment, read-access auditing, backup recovery and security review. No real patient records on public demo infrastructure.
- Obtain approved claims switch contract/test credentials, facility/practice and provider identifiers, validated ICD-10 and tariff codes, dependant details, scheme-specific rules, preauthorisation lifecycle, claim/response and ERA mapping, bank reconciliation and correction/reversal workflow. Do not treat internal JSON export as a valid scheme claim.
- Integrate with hospital HIS/EHR, pathology, PACS, pharmacy, theatre and finance systems using agreed interfaces (HL7/FHIR where supported). Add bed capacity/ward board, inventory, e-prescribing and clinical approval processes before actual deployment.
