# Phase 8 — Photo and Diary

**Status: Planned — scope needs a decision before any code is written**

**Scope note added 2026-10-01, after Phase 7.** The first two scope items below were delivered by
Phase 7, not deferred to this phase: `POST /api/photos` and `GET /api/photos/<id>/<filename>` write
and serve real pictures under `data/uploads/`, with magic-byte validation, server-generated names, a
size limit, and no path ever stored (ADR-051). Laundry cannot be completed by a sentence alone, and
`/habits` shows a Photo Diary timeline of those pictures.

What is left, and the reason this status says "needs a decision": the PRD describes a diary of
laundry photos **and daily notes**. Photos are handled; notes have nowhere to live.
`habit_log.photo_url` is the only column that can hold a picture, and no table exists for a dated
note. Adding one is a schema change this phase document was not written to authorise, so the
question — is a diary entry a photo, a note, or a row of its own? — is the user's to answer before
Phase 8 starts.

Scope taken from `Hari_OS_V1_PRD.docx` sections 6.6 and 1. This document does not expand it.

## Purpose

Turn laundry from a text claim into visible evidence, and build the visual diary that the
PRD describes as a timeline of laundry photos and daily notes.

## Scope

- **Laundry photo proof.** PRD section 6.6: the application does not accept a text claim alone.
  **Delivered in Phase 7** — there is no placeholder left to replace.
- **Local filesystem upload storage.** Files land under `data/uploads/`, never in `public/`
  (ADR-001; the PRD's Supabase Storage option was rejected in favour of the local
  filesystem). **Delivered in Phase 7**, in `src/lib/storage/photos.ts` with the feature slice
  owning every write (ADR-051, ADR-055).
- **Photo access through the PWA**, using the installable-app and camera access the PRD
  requires in sections 1 and 7. This is where the PWA foundation prepared in Phase 0 is
  finally used.
- **A visual diary**: the PRD describes the laundry photo and daily notes forming a visual
  timeline.

## Dependencies

- Phase 1 complete: schema and a working data path.
- Phase 7 provides the laundry habit that the photo attaches to.
- `src/lib/storage/` becomes real. **Done in Phase 7**; it holds `photos.ts` and a README that has
  been updated to say so.
- A PWA package is likely required here for installability and camera access. Phase 0
  deliberately added none (ADR-003). The package must be chosen and recorded as an ADR at
  the time this phase starts, not before.

## Boundaries

- **No upload logic is implemented in this document's phase planning.** This is a plan.
- **Uploads never go in `public/`.** Private user data stays in `data/uploads/`, which is
  git-ignored.
- **No cloud storage, no object store, no third-party media service.** ADR-001 fixed
  local filesystem storage; changing it requires a new ADR.
- No image recognition, tagging, or automated classification. The PRD does not ask for it.
- No video.
- Uploaded files are user data and must never be committed.

## Expected deliverables

- Storage implementation in `src/lib/storage/`, respecting the boundary that all filesystem
  access lives there.
- Photo upload attached to a laundry habit entry.
- The visual diary view.
- A PWA manifest, service worker, and icons, with the ADR recording the package choice.
- `data/uploads/` created on demand, as `data/` already is.

## Verification

- Baseline suite passes.
- A real photo is uploaded, stored under `data/uploads/`, retrieved, and displayed.
- `git check-ignore` proves `data/uploads/` and its contents are untracked, including after
  a real upload exists.
- **No uploaded file appears in `git status`, in any commit, or in the build output.**
- `public/` is demonstrated to contain no private user data.
- The app installs and launches, and the camera or file picker works on the target device.
- The diary renders with no photos and does not crash.
- Uploading a non-image file or an oversized file fails visibly rather than silently.

## Status

**Planned.** No upload code, no PWA manifest, no service worker, and no diary exist today.
`src/lib/storage/` contains only a README.
