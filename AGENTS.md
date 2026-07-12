# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

This is the MyUniVote backend API. It is an Express/Mongoose service with:

- Student and EC mobile APIs.
- School-admin web portal APIs.
- Super-admin/internal platform APIs.
- Firebase Storage uploads.
- Google OAuth for student and EC login.
- Cookie/CSRF school-admin auth.
- Redis-backed background and realtime support.

The app entry point is `server.js`.

## Current Product Rules

- Students and EC users sign in with `POST /auth/google`.
- School admins sign in with `POST /school-admin/auth/login`.
- Super admins sign in with `POST /super-admin/auth/login`.
- Do not reintroduce student password login unless explicitly requested.
- EC members are promoted from existing `Student` records.
- Use `POST /schools/:schoolId/ec-members` for EC promotion.
- Do not use or re-add `/schools/:schoolId/promote-ec-members`.
- EC election voter eligibility comes from audience filters against imported students.
- Do not reintroduce EC voter-list uploads.
- EC election aspirants are assigned from searched `Student` records.
- Do not reintroduce aspirant-list uploads.

## Important Data Model Notes

- `Student` is the real app user account.
- `SchoolStudentRecord` is still used as an import mirror and Google-login gate.
- `Aspirant` is an election-specific candidate record derived from a student.
- `Election.categories` stores category definitions.

## Route Conventions

- Student auth: `/auth/*`
- Student profile: `/students/*`
- Student election reads: `/elections/*`
- Student votes/PINs: `/votes/*`
- EC operations: `/ec/*`
- School-admin auth: `/school-admin/*`
- School-admin school portal: `/schools/:schoolId/*`
- Super-admin platform: `/super-admin/*`
- Internal school registration review: `/internal/school-registrations/*`

## Auth Expectations

- School-admin unsafe requests require cookies plus `X-CSRF-Token`.
- EC requests require `Authorization: Bearer <ec accessToken>`.
- Student requests require `Authorization: Bearer <student accessToken>`.
- Super-admin requests require `Authorization: Bearer <superAdminAccessToken>`.

## Editing Guidance

- Preserve existing user changes. The worktree may be dirty.
- Prefer small, focused changes.
- Use `rg` for searches.
- Use `apply_patch` for manual edits.
- Do not use destructive git commands unless the user explicitly asks.
- Avoid adding new dependencies unless the user approves.
- Keep files ASCII unless the edited file already uses non-ASCII.

## Validation

Useful checks:

```bash
node --check server.js
node --check routes/schoolRoutes.js
node --check routes/ecOperationsRoutes.js
node --check controllers/adminElectionController.js
node --check controllers/schoolEcMemberController.js
node --input-type=module -e "import fs from 'fs'; JSON.parse(fs.readFileSync('myunivote.postman_collection.json', 'utf8')); console.log('postman ok');"
```

Available package scripts include:

```bash
npm run dev
npm start
npm run test:runtime
npm run test:v6
```

Only run migration, cleanup, seed, or worker scripts when the user explicitly asks.

## Retired Flows To Avoid

- Student `/auth/login`.
- Manual student registration as the primary production flow.
- Direct EC registration.
- EC profile edit routes.
- Uploaded election voter lists.
- Uploaded aspirant lists.
- `/schools/:schoolId/promote-ec-members`.

## Documentation

- Mobile-facing API reference: `docs/mobile-api-change-notes.md`.
- School web API reference: `docs/web-api-reference.md`.
- Super-admin API reference: `docs/super-admin-web-api-reference.md`.
- Cross-team handoff: `docs/platform-mobile-web-change-handoff.md`.

Keep docs and Postman in sync when changing route contracts.
