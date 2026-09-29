# Storage

The local filesystem access boundary. Used for laundry photos, from Phase 8.

All filesystem reads and writes live here. Nothing else touches the disk directly, and
`public/` is never used for private user uploads.

No upload logic exists yet. This directory currently contains no code.
