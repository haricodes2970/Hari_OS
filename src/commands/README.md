# Commands

The natural language command engine. Begins in Phase 2.

This directory will turn a sentence such as "bought banana 10 rupees cash" into a
structured, typed intent. It will call OpenRouter at that time. No LLM dependency, SDK, or
parser exists here now.

The rule that shapes this boundary: the LLM only _interprets language and proposes a
structured intent_. It never performs persistence, never calculates a financial balance,
and never calculates an inventory quantity. Those are deterministic operations in
`src/domain`, applied by ordinary code.

So this directory validates a proposed intent against `src/lib/validation` and hands it to
the owning feature. It does not write to the database itself.
