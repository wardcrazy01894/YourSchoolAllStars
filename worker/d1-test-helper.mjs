/**
 * Test-only: a D1-shaped adapter over node:sqlite with the REAL migrations
 * applied, so worker tests pin what the SQL actually does. Not part of the
 * deployed worker (nothing imports it but *.test.mjs).
 */
import { readFileSync, readdirSync } from 'node:fs'
// node:sqlite is unflagged from Node 22.13 (package.json `engines`).
import { DatabaseSync } from 'node:sqlite'

function d1(db) {
  const wrap = (sql, args) => ({
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const info = db.prepare(sql).run(...args)
      return { meta: { changes: Number(info.changes) } }
    },
    first: async () => db.prepare(sql).all(...args)[0] ?? null,
    exec: () => ({ results: db.prepare(sql).all(...args) }),
  })
  return {
    // Like real D1, an unbound statement can run directly or be bound first.
    prepare: (sql) => ({
      ...wrap(sql, []),
      bind: (...args) => wrap(sql, args),
    }),
    // Like real D1, a batch is one transaction: all of it or none of it.
    batch: async (stmts) => {
      db.exec('BEGIN')
      try {
        const out = stmts.map((s) => s.exec())
        db.exec('COMMIT')
        return out
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
    /** Test convenience: run a query and return its rows. */
    rows: (sql, ...args) => db.prepare(sql).all(...args),
  }
}

/** A fresh in-memory database with every migration applied, in order. */
export function freshDb() {
  const raw = new DatabaseSync(':memory:')
  const dir = new URL('./migrations/', import.meta.url)
  for (const f of readdirSync(dir).sort()) {
    raw.exec(readFileSync(new URL(f, dir), 'utf8'))
  }
  return d1(raw)
}
