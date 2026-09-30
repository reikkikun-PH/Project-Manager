# UniEvent: Campus Event Reservation System — Reference Summary

> **Source:** `UniEvent.pdf` — SYSTEM PROPOSAL  
> **Prepared by:** Sabado Arch Jonel F. (LACA411A116)  
> **Submitted to:** Noel Montecillo  
> **Date:** September 26, 2026  
> **Platform:** Web Application

---

## 1. Overview

**UniEvent** is a web-based campus event and facility reservation system designed to replace manual paper forms and spreadsheets.

**Core Value Proposition:**
- Online booking + digital approvals
- Real-time availability calendar
- Automatic conflict / double-booking detection
- Email + in-app notifications

**Example Flow:** Student org books auditorium online → requests equipment (sound, projector, seating) → receives digital approval → gets updates if schedule changes.

---

## 2. Purpose

Digitize venue booking and approval processes to:
- Reduce manual administrative work
- Eliminate scheduling conflicts
- Improve transparency for admins, faculty, and student organizers

---

## 3. Objectives

### 3.1 General Objective
Design and develop an automated, web-based reservation and venue allocation system that streamlines booking requests, prevents conflicts, and expedites approvals.

### 3.2 Specific Objectives
1.  **Interactive Availability Calendar** — real-time booking status + automated conflict detection to prevent double-booking.
2.  **Online Portal for Organizers** — submit event proposals, select venues, request resources (sound systems, projectors, seating).
3.  **Role-Based Approval Engine** — facility heads / admins can approve, reject, or request revisions digitally.
4.  **Automated Notifications** — real-time email + in-app alerts; admin page to monitor reservation progress.
5.  **Analytics & Reporting** — dashboard tracking venue utilization rates, peak booking hours, event metrics.

---

## 4. Project Scope

### 4.1 In Scope
- User authentication + role-based access control (Student/Organizer, Approver/Staff, System Admin)
- Venue catalog management (capacity, amenities, rules, photos)
- Automated clash/conflict validation for overlapping time slots
- In-app + email notification system (admin page)
- Admin dashboard + downloadable PDF/CSV utilization reports

### 4.2 Out of Scope
- Financial transactions / paid ticketing (facility allocation only)
- Physical IoT integration (smart card doors, automated lockouts)
- Native mobile apps — will be responsive web app instead

---

## 5. System Features / Modules

| Module | Feature | Description |
| :--- | :--- | :--- |
| **User Management** | Authentication & Role Control | Account creation + role-based login |
| **User Management** | Organization Profile | Stores organization info/details |
| **Venue & Resource** | Facility Catalog | Shows available rooms, facilities, equipment |
| **Reservation** | Booking Calendar | Select date, time, facility for booking |
| **Approval** | Admin Approval Portal | Authorized users approve/reject requests |
| **Notifications** | Alerts | Notifications for bookings/approvals/changes in admin page |
| **Reporting** | Reports | Summaries of bookings & facility usage |
| **Administration** | System Settings | Manage facilities, users, system settings |

---

## 6. Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| Frontend | HTML, CSS, JavaScript | Website interface |
| Backend | PHP | System functions & data processing |
| Database | MySQL | Stores users, bookings, venues, etc. |
| Hosting | XAMPP | Local server for development |
| Version Control | Git / GitHub | Code storage & management |
| API Testing | Postman | Test system API requests |
| Design | Figma | UI/Interface design |

---

## 7. Target Users

| Role | Description | Key Needs / Usage |
| :--- | :--- | :--- |
| **Administrator** | Manages system & users | Manage users, facilities, system settings |
| **Facility Approver** | Checks & approves bookings | Review and approve/reject reservations |
| **Event Organizer** | Requests & manages bookings | Check availability & submit requests |

> Covers students, faculty, and student organizations as organizers; staff/facility heads as approvers.

---

## 8. Project Timeline / Work Plan

| Phase | Activities | Duration |
| :--- | :--- | :--- |
| Planning & Requirements Gathering | Identify requirements & define features | 1 week |
| System Design | UI/UX designs, database design, system structure | 1 week |
| Development | Frontend, backend, database functions | 5 weeks |
| Testing & QA | Test functions, identify errors, fix bugs | 2 weeks |
| Deployment | Prepare & configure completed web app | 1 week |
| Project Presentation | Demonstrate & submit completed system | 1 week |
| **Total** | | **11 weeks** |

---

## 9. Key Takeaways for Implementation

- **Must-have logic:** Overlap validation before confirming any booking; role middleware for 3 roles.
- **Core entities implied:** `users`, `organizations`, `venues`, `resources/equipment`, `bookings/reservations`, `approvals`, `notifications`, `reports`.
- **Deliverables:** Responsive web app (no native mobile), XAMPP-hosted PHP/MySQL, PDF/CSV exports.
- **Constraints:** No payments, no IoT, web-only.

---

*Generated from `UniEvent.pdf` (3 pages) as a quick reference. Refer to original PDF for full proposal details.*
