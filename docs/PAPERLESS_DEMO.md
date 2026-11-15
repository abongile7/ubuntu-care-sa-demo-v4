# Paperless private-hospital demo

Open `/login` and use a quick-login card (all seeded passwords `Demo123!`). From the care journey choose **Documents & communication**, or open `/connect`. Use separate browser profiles for simultaneous patient/doctor/practice sessions. Ordinary tabs share login cookies.

| Step | Role | Demonstrate |
| --- | --- | --- |
|1|Patient|Read the published demonstration form in Documents. Type the account name, confirm the acknowledgement statement and acknowledge that exact version. Open the protected print view. This is a demo acknowledgement, not a legally validated advanced signature.|
|2|Patient or doctor|Create a document draft, upload a fictional PDF/image/UTF-8 text file, and publish. A correction creates another version; the old acknowledgement does not acknowledge the new content.|
|3|Patient|Create a CARE conversation with the hospital doctor, send a message and optionally queue a simulated email notification. The email copy is generic and no email is sent externally.|
|4|Doctor|Open that member conversation and reply. A nonmember cannot read it; patient-visible conversations are separate from internal notes.|
|5|Patient|Submit a concern with a category and urgency. The assigned inbox and clinical/admissions reviewers receive notifications. Use normal fictional examples; the portal is not emergency care.|
|6|Doctor/nurse|Acknowledge/assign the concern, send a patient-visible response, resolve it and show how the patient can reopen it. Updates remain in the record.|
|7|Patient/administration|Request a specific previous-practice record with purpose, scope and explicit permission. Choose the registered `referring@ubuntucare.demo` account with its matching email, then the hospital simulates sending the request.|
|8|Referring practice|Sign in as `referring@ubuntucare.demo`. Only assigned requests are visible. Create a RECORD_REQUEST document for that exact request, upload the relevant fictional record, publish and fulfil the request.|
|9|Hospital doctor|Review received records. Revoke the request as the patient/hospital to show that future outside-practice access ends while hospital/patient records remain retained.|
|10|Patient/hospital|Request/confirm a future appointment, choose a clinician and explicit SAST times, view the month calendar and download the generic ICS. A conflicting confirmed booking is blocked even on another encounter.|
|11|Administrator|Process due reminders or run the reminder worker. Portal notifications persist; email activity remains simulated and repeated batches do not duplicate deliveries. Cancel a booking to stop pending reminders.|
|12|Patient + assigned clinician|Open a confirmed video appointment, record consent and allow camera/microphone. Test mute/end and device cleanup. Direct peer media is a local demo; cross-network service needs a validated relay. This managed Cloud browser blocks direct WebRTC media, so do not promise a full video call from its test result.|
|13|Billing/medical aid|Create a CLAIM conversation and supporting document bound to the exact shared claim. The insurer account receives only its scheme's permitted packet and supporting material, subject to live consent.|
|14|Hospital staff|Assign a department work item with an owner/due date and follow its state. This demonstrates coordination across departments, not a validated specialty clinical system.|
|15|Any permitted role|Ask the workflow assistant about appointments, records or claims. It returns rules-based guidance, and clinical questions route to humans rather than diagnosis/orders.|
|16|Administrator|Run functional checks. Published-version hashes are checked, while commercial readiness remains explicitly unestablished. Review the separate South African research/roadmap before any sales or real-data pilot.|

Seeded documents, conversations, a future video appointment, a concern, a consented previous-record request and department work items provide immediate examples. Use only fictional uploads. Consult README for the Codespaces launch and worker commands.
