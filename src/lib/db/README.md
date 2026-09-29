# Database

The SQLite access boundary. Introduced in micro-phase 0.5.

All database code lives here and nowhere else. No component, no domain rule, and no
command parser may import this directory directly.

Holds the connection, schema, migrations, and query functions. Business meaning does not
belong here: queries return data, and the rules that interpret it live in `src/domain`.

The database file lives at `data/hari-os.db`, outside `public/` and excluded from Git.
