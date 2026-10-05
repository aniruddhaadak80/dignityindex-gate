/**
 * Migrations are numbered, ordered, and idempotent. Never edit an applied migration —
 * append a new one. `user_version` is the source of truth for the applied prefix.
 */
export interface Migration {
  readonly version: number
  readonly name: string
  readonly up: readonly string[]
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial',
    up: [
      `CREATE TABLE IF NOT EXISTS records (
         id         TEXT PRIMARY KEY,
         kind       TEXT NOT NULL,
         payload    TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS records_kind_idx ON records (kind, updated_at DESC)`,
    ],
  },
  {
    version: 2,
    name: 'full_text',
    up: [
      `CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5 (
         id UNINDEXED, body, tokenize = 'porter unicode61'
       )`,
    ],
  },
  {
    version: 3,
    name: 'adjudication_ledger',
    up: [
      // Append-only by design: an adjudication record is evidence of what was decided and
      // when. If it could be edited or deleted, the ledger would prove nothing. The triggers
      // below make that a property of the database rather than a convention in calling code.
      `CREATE TABLE IF NOT EXISTS adjudication_events (
         receipt_id     TEXT PRIMARY KEY,
         case_id        TEXT NOT NULL,
         source_state   TEXT NOT NULL,
         target_state   TEXT NOT NULL,
         actor          TEXT NOT NULL,
         index_at_time  INTEGER NOT NULL,
         band           TEXT NOT NULL,
         recorded_at    INTEGER NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS adjudication_case_idx
         ON adjudication_events (case_id, recorded_at)`,
      `CREATE TRIGGER IF NOT EXISTS adjudication_events_no_update
         BEFORE UPDATE ON adjudication_events
         BEGIN SELECT RAISE(ABORT, 'adjudication_events is append-only'); END`,
      `CREATE TRIGGER IF NOT EXISTS adjudication_events_no_delete
         BEFORE DELETE ON adjudication_events
         BEGIN SELECT RAISE(ABORT, 'adjudication_events is append-only'); END`,
    ],
  },
]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0

export function pendingMigrations(current: number): readonly Migration[] {
  return MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version)
}
