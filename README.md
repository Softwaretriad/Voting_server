# MyUniVote Backend API

REST API for the MyUniVote mobile platform. This backend supports the student app contract, the admin election flow, runtime verification scripts, and post-election result delivery by email with PDF attachments.

## What This Backend Covers

- Student registration, email verification, login, logout, token checks, password reset, and voting PIN recovery
- Public school, faculty, and programme lookup for onboarding flows
- Student profile, active elections, schedule, statistics, notifications, news, voting, and results endpoints
- Admin election management endpoints for listing, creating, updating, scheduling, and deleting elections
- Uploaded voter registry rows stored in the `Voter` collection, while registered app users live in the `Student` collection
- Automatic election-close processing that generates result PDFs and emails verified voters
- Runtime smoke tests and a Postman collection for manual API verification

## Stack

- Node.js
- Express
- MongoDB with Mongoose
- JWT authentication
- Nodemailer for email delivery
- PDF generation for election result summaries

## Route Overview

Student authentication:

- `POST /auth/register`
- `POST /auth/verify-email`
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/check-tokens`
- `POST /auth/forgot-password`
- `POST /auth/verify-otp`
- `POST /auth/reset-password`

Public lookup:

- `GET /schools`
- `GET /schools/:schoolId/faculties`
- `GET /schools/:schoolId/faculties/:facultyId/programmes`

Student app:

- `GET /students/:userId`
- `GET /elections/active`
- `GET /elections/schedule`
- `GET /elections/statistics?year=YYYY`
- `GET /elections/results`
- `GET /elections/:electionId/categories`
- `GET /elections/:electionId/aspirants`
- `GET /categories/:categoryId/results`
- `GET /notifications/:userId`
- `GET /news/trending`

Voting:

- `POST /votes/verify-pin`
- `POST /votes/cast`
- `POST /votes/pin/forgot`
- `POST /votes/pin/verify-otp`
- `POST /votes/pin/reset`

Admin:

- `GET /admin/elections?status=draft|scheduled|active|closed`
- `POST /admin/elections`
- `PUT /admin/elections/:electionId`
- `PATCH /admin/elections/:electionId/schedule`
- `DELETE /admin/elections/:electionId`

Admin membership:

- `POST /api/ec/register`
- `POST /api/ec/add-member`
- `GET /api/ec/list/:schoolId`
- `DELETE /api/ec/:ecId`

## Data Model Notes

- `Student` stores real student app accounts that register, verify email, log in, and vote
- `Voter` stores uploaded election registry rows from the admin voter spreadsheet
- `Aspirant` stores uploaded aspirant spreadsheet rows
- The old legacy voter-auth flow has been removed from the active API surface

## Security Highlights

The backend includes a practical first round of hardening for sensitive student and admin flows:

- Passwords are hashed
- Voting PINs are hashed
- OTPs and reset tokens are stored as hashes
- Refresh tokens are stored as hashes
- Student and admin JWTs are role-scoped
- Rate limiting is applied to sensitive auth, PIN, and admin flows
- Request validation is applied on key endpoints
- Security headers and CORS middleware are enabled
- Audit logging is recorded for sensitive actions
- Forgot-password and forgot-PIN flows use anti-enumeration responses

Important deployment notes:

- Do not commit real `.env` secrets
- Rotate any credentials that were exposed during development
- In production, set `NODE_ENV=production`
- Restrict `ALLOWED_ORIGINS` to trusted frontend origins only

## Environment Variables

Create a `.env` file in the project root.

Example:

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/myunivote
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRATION=1h
JWT_REFRESH_EXPIRATION=7d
EMAIL_USER=your_email@example.com
EMAIL_PASS=your_email_app_password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
ALLOWED_ORIGINS=http://localhost:3000
NODE_ENV=development
```

Depending on your email provider and deployment target, you may also need provider-specific SMTP settings.

## Setup

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm run dev
```

Run with the normal start script:

```bash
npm start
```

If PowerShell blocks `npm`, use:

```bash
npm.cmd run dev
```

## Using ngrok

You can expose the local API over the internet for mobile-device testing with ngrok.

Start the backend:

```bash
npm run dev
```

Start the tunnel in a second terminal:

```bash
ngrok http 5000
```

If your server is running on a different port, tunnel that port instead.

Important notes:

- Use the generated HTTPS ngrok URL as your frontend or Postman `baseUrl`
- Add the ngrok origin to `ALLOWED_ORIGINS` in `.env` if CORS is restricted
- Free ngrok URLs usually change when the tunnel restarts
- Any callback URLs or links that must reach your local backend should use the current ngrok URL

## Demo Seed

Seed demo records for local testing:

```bash
npm.cmd run seed:demo
```

This creates a demo school, student, election, notification, and news dataset suitable for exercising the student app endpoints.

## Runtime Verification

Run the full student/runtime smoke test:

```bash
npm.cmd run test:runtime
```

Run the focused additions test:

```bash
npm.cmd run test:v6
```

These scripts hit the real API surface and are the fastest way to sanity-check behavior after changes.

## Postman

The repo includes a ready-to-import Postman collection:

- `myunivote.postman_collection.json`

It covers:

- student auth
- school lookup
- student profile, elections, voting, and results
- voting PIN recovery
- admin login and election CRUD

The collection also auto-saves common variables such as:

- `schoolId`
- `facultyId`
- `programId`
- `userId`
- `accessToken`
- `refreshToken`
- `adminToken`
- `electionId`
- `aspirantId`
- `categoryId`
- `pinResetToken`

## Project Layout

High-level structure:

- `server.js`
- `controllers/`
- `routes/`
- `models/`
- `middleware/`
- `utils/`
- `scripts/`

Important implementation files:

- `server.js`
- `controllers/studentAuthController.js`
- `controllers/studentVoteController.js`
- `controllers/adminElectionController.js`
- `models/Student.js`
- `models/Election.js`
- `middleware/security.js`
- `middleware/rateLimit.js`
- `middleware/validate.js`
- `utils/electionResultsProcessor.js`

## Election Results Processing

When an active election passes its end time, the backend can:

- close the election
- build a PDF result summary
- email verified student voters
- record delivery status on the election document

Relevant files:

- `utils/electionResultsProcessor.js`
- `utils/pdfResults.js`

## Migrations

To migrate old legacy `candidates` data into the new `aspirants` collection and normalize legacy `voters` records:

```bash
npm.cmd run migrate:legacy
```

This migration also backfills `Voter` rows from any existing elections that already stored `eligibleVoters`.

## Current Status

The codebase now covers:

- the core student app backend contract
- voting PIN recovery 
- admin election CRUD and scheduling 
- security hardening for sensitive flows
- runtime verification scripts
