# UniEvent — Campus Event Reservation System (Prototype)

Simple offline prototype. No install, no server — just open and use.

## Quick Start (30 seconds)
1. Double-click **`index.html`** (or drag it into Chrome/Edge/Firefox)
2. Pick a role and click **Sign in** (password = anything)
3. Done — try booking a venue!

> Works via `file://` offline. All data stays in your browser (localStorage).

## Demo Logins (from `data/accounts.json`)
| Role | Email | Password | What you can do |
|------|-------|----------|-----------------|
| **Organizer** | `organizer@university.edu` | `organizer123` | Create bookings, view My Bookings |
| **Organizer** | `jamie.cruz@university.edu` | `organizer123` | Create bookings (Engineering) |
| **Approver** | `approver@university.edu` | `approver123` | Approve / Reject / Request Revision |
| **Approver** | `luis.delacruz@university.edu` | `approver123` | Approve (Sports Complex) |
| **Admin** | `admin@university.edu` | `admin123` | Full access + manage venues & users |
| **Admin** | `it.admin@university.edu` | `admin123` | Full access (IT Center) |

> Accounts are stored in [`data/accounts.json`](data/accounts.json) (also copied to `accounts.json` at root). Edit that file to add/remove users — no code change needed. Passwords are plain text for demo only.
> Via `file://` the browser blocks `fetch`, so the app falls back to embedded defaults (any password works). Via `http://` (XAMPP/Live Server) passwords are enforced.

## What You Can Try
- **Facility Catalog** — search/filter venues, click "Book this"
- **Booking Calendar** — pick date/time, system blocks overlaps + checks capacity
- **My Bookings** — view/cancel your requests
- **Approval Portal** — login as Approver/Admin to approve
- **Notifications** — see updates + unread count
- **Reports** — peak hour, busiest venue, approval rate + **Export CSV/PDF**
- **System Settings** — add/remove venues, edit organization

**Key rule:** Same venue + same date + overlapping time = blocked. Rejected bookings are ignored.

## Files (Simplified)
```
prototype/
├── index.html            ← open this (clean, readable HTML)
├── css/style.css         ← all styles & colors (edit :root to retheme)
├── js/app.js             ← all logic & demo data (localStorage)
├── data/accounts.json    ← Organizer / Approver / Admin accounts (edit here)
├── accounts.json         ← alias copy at root (same content)
└── README.md             ← this guide
```

Previously everything was in one 900-line file — now split for ease of editing.
Still **fully portable**: copy the folder to USB/ZIP, no dependencies.

## Tips
- **Reset data:** Login screen → "Reset Demo Data" or Settings → Reset
- **Clear bookings:** Settings → "Clear all bookings"
- **Capacity check:** Attendees > venue capacity = warning
- **Conflict demo:** Book Main Auditorium 2026-09-28 09:00-12:00 again → conflict appears

## From Prototype to Real App
This is static for demo ease. Real version (PHP/MySQL/XAMPP) just replaces `localStorage` with database tables: `users`, `venues`, `bookings`, `notifications`. UI stays the same.

---
*Proposal by Sabado Arch Jonel F. — LACA411A116 • v1.0 • 2026-09-21*
