import Database from 'better-sqlite3'
import { MIGRATIONS, LATEST_VERSION, pendingMigrations } from './migrations.js'

export interface RecordRow {
  id: string
  kind: string
  payload: string
  created_at: number
  updated_at: number
}

/** One adjudication, exactly as the engine's receipt stated it. */
export interface AdjudicationRow {
  receipt_id: string
  case_id: string
  source_state: string
  target_state: string
  actor: string
  index_at_time: number
  band: string
  recorded_at: number
}

/**
 * Every write goes through `transaction()`. No ad-hoc db.exec outside it — that rule is
 * what makes concurrent writers safe and makes a failed write leave no partial state.
 */
export class Store {
  readonly #db: Database.Database

  constructor(path = ':memory:') {
    this.#db = new Database(path)
    this.#db.pragma('journal_mode = WAL')
    this.#db.pragma('foreign_keys = ON')
    this.migrate()
  }

  get version(): number {
    return (this.#db.pragma('user_version', { simple: true }) as number) ?? 0
  }

  get isPending(): boolean {
    return pendingMigrations(this.version).length > 0
  }

  migrate(): number {
    const from = this.version
    for (const migration of pendingMigrations(from)) {
      this.transaction(() => {
        for (const statement of migration.up) this.#db.exec(statement)
        this.#db.pragma(`user_version = ${migration.version}`)
      })
    }
    return this.version
  }

  transaction<T>(fn: () => T): T {
    return this.#db.transaction(fn)()
  }

  put(record: { id: string; kind: string; payload: unknown; now: number }): void {
    const text = JSON.stringify(record.payload)
    this.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO records (id, kind, payload, created_at, updated_at)
           VALUES (@id, @kind, @payload, @now, @now)
           ON CONFLICT(id) DO UPDATE SET
             payload = excluded.payload,
             updated_at = excluded.updated_at`,
        )
        .run({ id: record.id, kind: record.kind, payload: text, now: record.now })

      // FTS5 virtual tables do not support UPSERT (ON CONFLICT), so the index row is
      // replaced explicitly. This is a SQLite limitation, not a style preference.
      this.#db.prepare('DELETE FROM records_fts WHERE id = ?').run(record.id)
      this.#db.prepare('INSERT INTO records_fts (id, body) VALUES (?, ?)').run(record.id, text)
    })
  }

  get(id: string): RecordRow | undefined {
    return this.#db.prepare('SELECT * FROM records WHERE id = ?').get(id) as RecordRow | undefined
  }

  list(kind: string, limit = 50): readonly RecordRow[] {
    return this.#db
      .prepare('SELECT * FROM records WHERE kind = ? ORDER BY updated_at DESC LIMIT ?')
      .all(kind, limit) as RecordRow[]
  }

  search(query: string, limit = 50): readonly RecordRow[] {
    return this.#db
      .prepare(
        `SELECT r.* FROM records_fts f
           JOIN records r ON r.id = f.id
           WHERE records_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(query, limit) as RecordRow[]
  }

  delete(id: string): boolean {
    return this.transaction(() => {
      const result = this.#db.prepare('DELETE FROM records WHERE id = ?').run(id)
      this.#db.prepare('DELETE FROM records_fts WHERE id = ?').run(id)
      return result.changes > 0
    })
  }

  /**
   * Append one adjudication. There is deliberately no update and no delete: the receipt id
   * is the engine's own primary key, so replaying an adjudication is idempotent rather than
   * duplicative, and the database triggers refuse any attempt to rewrite history.
   */
  recordEvent(event: {
    receiptId: string
    caseId: string
    source: string
    target: string
    actor: string
    index: number
    band: string
    now: number
  }): void {
    this.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO adjudication_events (
             receipt_id, case_id, source_state, target_state,
             actor, index_at_time, band, recorded_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(receipt_id) DO NOTHING`,
        )
        .run(
          event.receiptId,
          event.caseId,
          event.source,
          event.target,
          event.actor,
          event.index,
          event.band,
          event.now,
        )
    })
  }

  eventsFor(caseId: string): readonly AdjudicationRow[] {
    return this.#db
      .prepare('SELECT * FROM adjudication_events WHERE case_id = ? ORDER BY recorded_at, receipt_id')
      .all(caseId) as AdjudicationRow[]
  }

  /** The current state of a case, derived from its ledger. null means it has never moved. */
  currentState(caseId: string): string | null {
    const rows = this.eventsFor(caseId)
    return rows.length === 0 ? null : (rows[rows.length - 1]?.target_state ?? null)
  }

  close(): void {
    this.#db.close()
  }
}

export { LATEST_VERSION, MIGRATIONS }
