# Domain

Pure business rules, calculations, and types.

Imports nothing from the rest of the application. No React, no database, no filesystem,
no LLM. If a rule here cannot be tested with plain input and output, it is in the wrong place.

This is where deterministic arithmetic belongs: balance updates and inventory quantity
changes are computed here, never by the LLM and never in a component.
