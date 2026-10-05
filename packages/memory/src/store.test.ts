import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Store } from './store.js'
import { LATEST_VERSION, pendingMigrations } from './migrations.js'

describe('Store', () => {
  it('migrates an empty database to the latest version', () => {
    const store = new Store()
    expect(store.version).toBe(LATEST_VERSION)
    expect(store.isPending).toBe(false)
    store.close()
  })

  it('is idempotent — migrating twice changes nothing', () => {
    const store = new Store()
    store.migrate()
    expect(store.migrate()).toBe(LATEST_VERSION)
    expect(pendingMigrations(LATEST_VERSION)).toHaveLength(0)
    store.close()
  })

  it('round-trips a record', () => {
    const store = new Store()
    store.put({ id: 'a', kind: 'note', payload: { text: 'hello' }, now: 1 })
    expect(store.get('a')?.payload).toBe('{"text":"hello"}')
    store.close()
  })

  it('updates in place rather than duplicating', () => {
    const store = new Store()
    store.put({ id: 'a', kind: 'note', payload: { v: 1 }, now: 1 })
    store.put({ id: 'a', kind: 'note', payload: { v: 2 }, now: 2 })
    expect(store.list('note')).toHaveLength(1)
    expect(store.get('a')?.payload).toBe('{"v":2}')
    store.close()
  })

  it('finds records with full-text search', () => {
    const store = new Store()
    store.put({ id: 'a', kind: 'note', payload: { text: 'alpha beta' }, now: 1 })
    store.put({ id: 'b', kind: 'note', payload: { text: 'gamma delta' }, now: 2 })
    expect(store.search('alpha').map((r) => r.id)).toEqual(['a'])
    store.close()
  })

  it('rolls a failed transaction back completely', () => {
    const store = new Store()
    expect(() =>
      store.transaction(() => {
        store.put({ id: 'x', kind: 'note', payload: {}, now: 1 })
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(store.get('x')).toBeUndefined()
    store.close()
  })
})

const event = (receiptId: string, target: string, now: number) => ({
  receiptId,
  caseId: 'CASE-0001',
  source: 'draft',
  target,
  actor: 'reviewer@board',
  index: 84,
  band: 'clear',
  now,
})

describe('the adjudication ledger', () => {
  it('appends an event and reads it back', () => {
    const store = new Store()
    store.recordEvent(event('r1', 'evidenced', 1))
    expect(store.eventsFor('CASE-0001')).toHaveLength(1)
    expect(store.eventsFor('CASE-0001')[0]?.receipt_id).toBe('r1')
    store.close()
  })

  it('derives the current state from the last event', () => {
    const store = new Store()
    expect(store.currentState('CASE-0001')).toBeNull()
    store.recordEvent(event('r1', 'evidenced', 1))
    store.recordEvent(event('r2', 'adjudicated', 2))
    expect(store.currentState('CASE-0001')).toBe('adjudicated')
    store.close()
  })

  it('is idempotent on the receipt id, so replay does not duplicate', () => {
    const store = new Store()
    store.recordEvent(event('r1', 'evidenced', 1))
    store.recordEvent(event('r1', 'evidenced', 1))
    expect(store.eventsFor('CASE-0001')).toHaveLength(1)
    store.close()
  })

  it('refuses an update at the database, not merely in calling code', () => {
    // A second raw connection is the honest way to test this: it proves the guarantee is a
    // property of the schema, so it holds for any writer, not just for Store's own methods.
    const file = join(mkdtempSync(join(tmpdir(), 'ledger-')), 'ledger.db')
    const dirs = [dirname(file)]
    try {
      const store = new Store(file)
      store.recordEvent(event('r1', 'evidenced', 1))
      store.close()

      const raw = new Database(file)
      expect(() =>
        raw.prepare("UPDATE adjudication_events SET target_state = 'released'").run(),
      ).toThrowError(/append-only/)
      expect(raw.prepare('SELECT target_state FROM adjudication_events').all()).toEqual([
        { target_state: 'evidenced' },
      ])
      raw.close()
    } finally {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a delete at the database', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ledger-')), 'ledger.db')
    const dirs = [dirname(file)]
    try {
      const store = new Store(file)
      store.recordEvent(event('r1', 'evidenced', 1))
      store.close()

      const raw = new Database(file)
      expect(() => raw.prepare('DELETE FROM adjudication_events').run()).toThrowError(/append-only/)
      expect(raw.prepare('SELECT COUNT(*) AS n FROM adjudication_events').get()).toEqual({ n: 1 })
      raw.close()
    } finally {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('orders events by time then receipt id', () => {
    const store = new Store()
    store.recordEvent(event('r2', 'evidenced', 1))
    store.recordEvent(event('r1', 'draft', 1))
    store.recordEvent(event('r3', 'adjudicated', 2))
    expect(store.eventsFor('CASE-0001').map((row) => row.receipt_id)).toEqual(['r1', 'r2', 'r3'])
    store.close()
  })

  it('keeps cases separate', () => {
    const store = new Store()
    store.recordEvent(event('r1', 'evidenced', 1))
    store.recordEvent({ ...event('r9', 'blocked', 2), caseId: 'CASE-0002' })
    expect(store.eventsFor('CASE-0001')).toHaveLength(1)
    expect(store.eventsFor('CASE-0002')).toHaveLength(1)
    store.close()
  })
})
