# Hari OS — Documentation

Navigation entry point for project documentation. Start here if you are new to the repo.

## Where things are

```
docs/
├── README.md            this file — navigation
├── project/             durable, authoritative project-level documents
│   ├── PROJECT_STATUS.md    current phase, micro-phase, status, next action
│   ├── ARCHITECTURE.md      boundaries and dependency direction
│   ├── DECISIONS.md         architectural decisions (ADRs)
│   ├── ROADMAP.md           phase-level roadmap
│   └── REPOSITORY_BASELINE.md  what the repository looked like at the start
├── phases/              one document per product phase (1–9)
└── sessions/            one report per coding session
```

The product requirements themselves live in the repository root as
`Hari_OS_V1_PRD.docx`. The PRD is the product authority; nothing in this directory may
add product scope beyond it.

## Canonical sources of truth

| Question | Source |
| --- | --- |
| What should the product do? | `../Hari_OS_V1_PRD.docx` |
| What is the current phase and micro-phase? | `project/PROJECT_STATUS.md` |
| What is the phase-level plan? | `project/ROADMAP.md` |
| Where does code go, and what may import what? | `project/ARCHITECTURE.md` |
| Why is it built that way? | `project/DECISIONS.md` |
| What does a given phase cover? | `phases/` |
| What actually happened, and what was verified? | `sessions/` |
| How should agents work here? | `../AGENTS.md` |

Precedence: the PRD sets product requirements. `ARCHITECTURE.md` plus `DECISIONS.md` set
architecture. `PROJECT_STATUS.md` sets implementation status. When documentation disagrees
with the code, inspect the repository and **record the discrepancy** rather than silently
changing either side.

## The three kinds of document

- **Project documents** (`project/`) are durable. They describe how the project is built and
  what it currently is. They are updated in place, not rewritten per phase.
- **Phase documents** (`phases/`) describe the intended scope, dependencies, boundaries, and
  completion criteria of one phase. They are written ahead of the work and updated as it
  progresses. A phase document is a *plan and a contract*, not a log — the log is in
  `sessions/`.
- **Session reports** (`sessions/`) are append-only records of what actually happened on a
  given day: micro-phases attempted and completed, files changed, verification performed,
  problems hit, and the resulting commits. They are never rewritten to hide mistakes.

## Reading order

1. `../AGENTS.md` — the operating rules
2. `project/PROJECT_STATUS.md` — where the project actually is right now
3. The relevant `phases/` document
4. The most recent `sessions/` report for recent context
