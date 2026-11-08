# Smart Attendance Interface (HCI Final Project #18)

A redesigned attendance system for **teachers and students**, built as a mobile-first web app.
Full stack: Node.js backend + SQLite database + vanilla JS frontend. No installs needed (Node 22+).

## Run it

```bash
cd smart-attendance
npm start            # http://localhost:3000
npm test             # 23 API tests of the attendance rules
```

Open the **LAN address** printed in the terminal on your phone (same Wi-Fi) to test it as a mobile app.

| Role | Login | Password |
|---|---|---|
| Teacher (teaches HCI) | `teacher1` | `teacher123` |
| Teacher (teaches Rizal) | `teacher2` | `teacher123` |
| Student (Sec A) | `2024-001` … `2024-005` | same as ID |
| Student (Sec B) | `2024-006` … `2024-010` | same as ID |

Seed data includes 3 weeks of attendance history. HCI meets Mon–Fri 3:00–4:00 PM, Rizal 1:00–2:00 PM.

## Your design, as built

**Check-in rule** (from your notes; the window is per class): start → start+15 min = **Present**; +16 min → end = **Late**; otherwise **Absent** (check-in is blocked; no scan by class end = Absent).

**Teacher flow:** login → create class (subject, days, time) → register students by section → QR code + class code (full-screen mode for projecting) → live roster by section (P / L / A) → reports.
**Student flow:** login → check in (scan QR *or* type class code; your Student ID comes from your login) → attendance status, class schedule, attendance history.

| Required feature | Where |
|---|---|
| Student login | Login screen (teachers use the same form) |
| Attendance status | Student Home → "Attendance status today" |
| Class schedule | Home (today) and Schedule tab (weekly) |
| Attendance history | History tab (filter by class, rates) |
| Instructor dashboard | Teacher → Classes (live counts) and class page (roster) |
| Reports | Teacher → Reports (per student, per date, CSV, print) |

## Testing without waiting for class: the Demo clock
Open **Demo clock** (bar under the header), pick e.g. *Mon 9 Nov 3:05 PM*, and try Present (3:00–3:15), Late (3:16–4:00), too early, and closed. "Use real time" resets it. It affects everyone on the server (for demos only).

## HCI focus: reducing errors in attendance recording
| Error risk | Design response | Principle |
|---|---|---|
| Typo in class code | Auto-uppercase, auto hyphen (`K7M-4PX`), ambiguous letters (O/0, I/1/L) never used, Continue disabled until 6 characters | Error prevention; Hick's/Fitts' |
| Checking in to the wrong class / as the wrong person | **Confirm screen** shows class, section, your name/ID and the status you'll get before saving; "Not my class" escape | Prevent errors; user control |
| Double check-in | Idempotent: shows "Already checked in at…" | Consistency; feedback |
| Wrong/late/early attempts | Specific message + what to do ("Starts at 3:00 PM", "Ask your teacher if this is a mistake") | Help users recover from errors |
| Teacher mis-marking | Tap a student → Present/Late/Absent; **Undo** toast; rows say "edited by you" | User control; visibility |
| Code shared outside class | **New code** button invalidates the old QR/code (with confirmation) | Safety |
| Bad student lists | Bulk add reports line-by-line problems instead of failing silently | Error recovery |
| Remote spoofing of IDs | Login required; session cookie is HttpOnly; passwords hashed (scrypt); login rate-limited | Ethics: security/privacy |

Other principles applied: visibility of status (live roster, clock, status chips with icon + text, never colour alone), recognition over recall, minimalist UI (4 tabs for students, 3 for teachers), consistent buttons/chips, familiar icons with labels, WCAG-AA contrast, 44–60 px tap targets, keyboard + screen-reader support (landmarks, labels, live regions, skip link), **A+ larger-text toggle**, reduced-motion support, Data Privacy Act-minded data (only ID, name, attendance stored).

## Built-in usability metrics (Lesson 3)
**Reports → Usability metrics** records real check-ins: success rate (task completion), median time to check in (time on task), student errors by type (error rate), and teacher corrections. Use these numbers in your evaluation write-up.

### Suggested test plan
1. 5+ representative users; tasks: *(student)* check in to HCI by QR, by typed code, find yesterday's status; *(teacher)* create a class, register 3 students, mark one Late, download the CSV.
2. Run moderated think-aloud sessions; note errors and confusion.
3. Read the metrics page; compute task completion = successes ÷ attempts.
4. Fix the top problems, retest (iterate), and report before/after.

## Notes and limits
- QR scanning uses the browser's camera API, which needs **HTTPS or localhost**. On plain-http LAN, students scan the QR with the phone's normal camera app (it opens the check-in screen) or type the code. Both paths are built in.
- Students' first password is their Student ID (prototype shortcut; a real system would force a change).
- Not included: password change, class editing/deletion, email notifications.

## Files
`server.js` API + database + rules · `public/` app (`app.js`, `styles.css`, `qr.js` own QR generator) · `test.js` API tests · `data/` SQLite file (created on first run; delete to reset).
