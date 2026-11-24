# Hospital onboarding and remote care demonstration

Synthetic data only. The new workspace is /remote. Admissions registers a fictional patient and issues a single-use 30-minute activation code. The patient enters it at /activate, sets a password, logs in using their registered email, opens /remote and saves contact/funding and consent choices. The patient requests a consultation with a doctor, mode and SAST time. A doctor in a separate browser profile signs in and accepts it. Requests do not reserve a calendar slot.

## Run
Node 22+, npm ci, copy .env.example to .env. On a disposable database run npm run db:setup, then npm run dev. On an existing demo database use npm run db:push after backing up; do not reseed unless intentionally resetting. Access http://localhost:3000 (localhost enables browser media). Use admin@ubuntucare.demo and doctor@ubuntucare.demo, password Demo123!, in separate browser profiles. A seeded patient account can also demonstrate the consultation without activation.

## Communications
- Chat persists to SQLite and polls approximately every two seconds. Only the assigned doctor and owning patient can access the thread. Sending requires acceptance and both consent flags.
- Video and internet audio use WebRTC browser media, offer/answer signaling through the authenticated API, no recording, and manual answer/hangup. The patient initiates. Two browsers on the same machine/network can attempt direct connectivity. Use headphones to avoid echo. Browser permission and HTTPS (or localhost) required. For remote networks configure REMOTE_ICE_SERVERS as a JSON array of RTCIceServer objects; deploy an approved TURN relay with short-lived credentials for reliable cross-network operation. Without it some calls will fail. Static TURN credentials are not recommended for production. Do not send live health information.
- Normal phone consultation uses a tel: link to an operator-configured, authorized test E.164 number (REMOTE_DEMO_PHONE). The device needs a dialer. There is no PSTN bridge, incoming telephone integration, connection status or carrier callback yet. Dial requests are logged, not call completion.
- In-person requests are also supported. All consultation modes are clinician-accepted requests, not automatic calendar confirmations.
- Ending browser calls clears the stored session description; closing a tab stops local media but the other participant may need to use End call. Completing/cancelling ends signaling; the browser checks status during polling.
- Revoking consent via remote onboarding cancels open requests. Existing chat history is retained; clinical retention and access policy must be agreed before production.

## Deployment
Host the Next.js app behind HTTPS on a Node host with a persistent writable SQLite volume (do not use GitHub Pages). Set REMOTE_APP_ORIGIN to the exact public HTTPS origin if proxy request URLs differ. Use synthetic credentials; this is not a public production service. Before live deployment: hospital identity verification, protected staff enrolment and MFA, rate limits, tenancy and assignment checks across legacy modules, provider/telephone contracts, network TURN and security testing, operational monitoring, clinical safety and privacy review, backup/restore, retention policy, verified appointment calendar and hospital integrations. No claim of POPIA compliance or clinical approval.

## Acceptance checklist
1. Admissions registers, issues code; code can be used once only. Login with the new password.
2. Patient saves consent, requests VIDEO, AUDIO, PHONE, CHAT or IN_PERSON. Doctor sees and accepts; unrelated patient and doctor cannot see or mutate it.
3. Exchange chat messages in two browser profiles. Reload and verify history.
4. For VIDEO/AUDIO, start as patient and answer as doctor. Confirm both media tracks, mute and hangup. Verify cancellation and consent revocation.
5. Configure an authorized test number and open a PHONE consultation; verify the device dialer opens and no false completed-call event exists.
6. Complete as doctor; further messages rejected. Check audit rows for actions. Run npm run typecheck, npm run build and npm test.
