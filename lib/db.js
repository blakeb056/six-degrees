import {
  getDb, newId, nowIso, decodeRow, encodeValue,
} from './db-client.js';

// A supabase-js-shaped query builder over local SQLite.
//
// The point is that the twelve API routes keep their existing call chains —
// .from().select().eq().order().single() and friends — while the data lives in
// a file on the user's machine instead of a hosted database. Five behaviours
// are load-bearing and are pinned by tests in tests/db.test.mjs:
//
//   1. It RESOLVES to { data, error }. It never rejects, because no call site
//      wraps these in try/catch expecting a throw.
//   2. It is thenable AND catchable — several routes await the builder itself
//      rather than calling a terminal method.
//   3. It MUTATES and returns `this`. app/api/notifications/route.js calls
//      q.eq(...) without reassigning the result; an immutable builder would
//      silently drop that filter with no error and no failing test.
//   4. .single() yields { data: null, error } when nothing matches.
//   5. Column names stay snake_case throughout.

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

function assertIdentifier(name, kind) {
  if (!IDENTIFIER.test(name)) throw new Error(`Unsafe ${kind}: ${name}`);
  return name;
}

class QueryBuilder {
  constructor(table) {
    this.table = assertIdentifier(table, 'table');
    this._columns = '*';
    this._filters = [];      // { sql, params }
    this._order = null;
    this._limit = null;
    this._single = false;
    this._op = 'select';
    this._payload = null;
    this._onConflict = null;
    this._ignoreDuplicates = false;
  }

  select(columns = '*') {
    // On insert/update/delete, .select() only asks for the rows back.
    if (this._op === 'select') this._columns = columns === '*' ? '*' : columns;
    this._returning = true;
    return this;
  }

  eq(column, value) {
    assertIdentifier(column, 'column');
    if (value === null) this._filters.push({ sql: `"${column}" IS NULL`, params: [] });
    else this._filters.push({ sql: `"${column}" = ?`, params: [encodeValue(this.table, column, value)] });
    return this;
  }

  neq(column, value) {
    assertIdentifier(column, 'column');
    this._filters.push({ sql: `"${column}" IS NOT ?`, params: [encodeValue(this.table, column, value)] });
    return this;
  }

  in(column, values) {
    assertIdentifier(column, 'column');
    const list = Array.isArray(values) ? values : [];
    if (!list.length) {
      this._filters.push({ sql: '0 = 1', params: [] });   // matches nothing, like PostgREST
      return this;
    }
    this._filters.push({
      sql: `"${column}" IN (${list.map(() => '?').join(', ')})`,
      params: list.map((v) => encodeValue(this.table, column, v)),
    });
    return this;
  }

  ilike(column, pattern) {
    assertIdentifier(column, 'column');
    // SQLite's LIKE is case-insensitive for ASCII by default, which is the
    // behaviour ilike callers rely on here.
    this._filters.push({ sql: `"${column}" LIKE ?`, params: [pattern] });
    return this;
  }

  not(column, operator, value) {
    assertIdentifier(column, 'column');
    if (operator === 'is' && value === null) {
      this._filters.push({ sql: `"${column}" IS NOT NULL`, params: [] });
    } else {
      this._filters.push({ sql: `NOT ("${column}" = ?)`, params: [encodeValue(this.table, column, value)] });
    }
    return this;
  }

  is(column, value) {
    assertIdentifier(column, 'column');
    if (value === null) this._filters.push({ sql: `"${column}" IS NULL`, params: [] });
    else this._filters.push({ sql: `"${column}" = ?`, params: [encodeValue(this.table, column, value)] });
    return this;
  }

  order(column, { ascending = true } = {}) {
    assertIdentifier(column, 'column');
    // NULLS LAST on descending sorts matches Postgres' default ordering, which
    // keeps unscored rows from floating to the top of the galaxy.
    this._order = `"${column}" ${ascending ? 'ASC' : 'DESC NULLS LAST'}`;
    return this;
  }

  limit(n) {
    this._limit = Number(n) || 0;
    return this;
  }

  single() {
    this._single = true;
    this._limit = this._limit ?? 1;
    return this;
  }

  maybeSingle() {
    return this.single();
  }

  insert(rows) {
    this._op = 'insert';
    this._payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows, options = {}) {
    this._op = 'upsert';
    this._payload = Array.isArray(rows) ? rows : [rows];
    this._onConflict = options.onConflict || null;
    this._ignoreDuplicates = !!options.ignoreDuplicates;
    return this;
  }

  update(values) {
    this._op = 'update';
    this._payload = values;
    return this;
  }

  delete() {
    this._op = 'delete';
    return this;
  }

  _where() {
    if (!this._filters.length) return { sql: '', params: [] };
    return {
      sql: ' WHERE ' + this._filters.map((f) => f.sql).join(' AND '),
      params: this._filters.flatMap((f) => f.params),
    };
  }

  _run() {
    const db = getDb();
    const where = this._where();

    if (this._op === 'select') {
      let sql = `SELECT ${this._columns === '*' ? '*' : this._columns} FROM "${this.table}"${where.sql}`;
      if (this._order) sql += ` ORDER BY ${this._order}`;
      if (this._limit != null) sql += ` LIMIT ${Number(this._limit)}`;
      const rows = db.prepare(sql).all(...where.params).map((r) => decodeRow(this.table, r));
      if (this._single) {
        if (!rows.length) return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
        return { data: rows[0], error: null };
      }
      return { data: rows, error: null };
    }

    if (this._op === 'insert' || this._op === 'upsert') {
      const inserted = [];
      for (const raw of this._payload) {
        const row = { id: raw.id || newId(), ...raw };
        if (!row.id) row.id = newId();
        const cols = Object.keys(row).filter((c) => IDENTIFIER.test(c));
        const values = cols.map((c) => encodeValue(this.table, c, row[c]));
        const placeholders = cols.map(() => '?').join(', ');
        const quoted = cols.map((c) => `"${c}"`).join(', ');

        let sql = `INSERT INTO "${this.table}" (${quoted}) VALUES (${placeholders})`;
        if (this._op === 'upsert') {
          if (this._ignoreDuplicates) {
            sql += ' ON CONFLICT DO NOTHING';
          } else {
            const target = this._onConflict
              ? this._onConflict.split(',').map((c) => `"${c.trim()}"`).join(', ')
              : '"id"';
            const assignments = cols
              .filter((c) => c !== 'id')
              .map((c) => `"${c}" = excluded."${c}"`)
              .join(', ');
            sql += ` ON CONFLICT (${target}) DO UPDATE SET ${assignments || '"id" = "id"'}`;
          }
        }
        try {
          db.prepare(sql).run(...values);
          const back = db.prepare(`SELECT * FROM "${this.table}" WHERE id = ?`).get(row.id);
          if (back) inserted.push(decodeRow(this.table, back));
        } catch (err) {
          if (this._op === 'upsert' && /UNIQUE constraint/i.test(err.message)) continue;
          return { data: null, error: { message: err.message } };
        }
      }
      if (this._single) return { data: inserted[0] ?? null, error: inserted.length ? null : { message: 'Insert returned no row' } };
      return { data: inserted, error: null };
    }

    if (this._op === 'update') {
      const values = { ...this._payload };
      if ('updated_at' in values === false && this.table === 'linkedin_connections') {
        values.updated_at = nowIso();
      }
      const cols = Object.keys(values).filter((c) => IDENTIFIER.test(c));
      if (!cols.length) return { data: [], error: null };
      const assignments = cols.map((c) => `"${c}" = ?`).join(', ');
      const params = cols.map((c) => encodeValue(this.table, c, values[c]));
      const sql = `UPDATE "${this.table}" SET ${assignments}${where.sql}`;
      try {
        const affected = db.prepare(`SELECT id FROM "${this.table}"${where.sql}`).all(...where.params);
        db.prepare(sql).run(...params, ...where.params);
        const rows = affected
          .map((r) => db.prepare(`SELECT * FROM "${this.table}" WHERE id = ?`).get(r.id))
          .filter(Boolean)
          .map((r) => decodeRow(this.table, r));
        if (this._single) return { data: rows[0] ?? null, error: rows.length ? null : { message: 'No rows updated' } };
        return { data: rows, error: null };
      } catch (err) {
        return { data: null, error: { message: err.message } };
      }
    }

    if (this._op === 'delete') {
      try {
        const doomed = db.prepare(`SELECT * FROM "${this.table}"${where.sql}`).all(...where.params)
          .map((r) => decodeRow(this.table, r));
        db.prepare(`DELETE FROM "${this.table}"${where.sql}`).run(...where.params);
        return { data: doomed, error: null };
      } catch (err) {
        return { data: null, error: { message: err.message } };
      }
    }

    return { data: null, error: { message: `Unsupported operation: ${this._op}` } };
  }

  // Thenable: `await supabase.from(...).select()` works, and so does awaiting
  // the builder after only calling filters.
  then(onFulfilled, onRejected) {
    let result;
    try {
      result = this._run();
    } catch (err) {
      result = { data: null, error: { message: err.message } };
    }
    return Promise.resolve(result).then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    return this.then(undefined, onRejected);
  }

  finally(onFinally) {
    return this.then(
      (v) => { onFinally?.(); return v; },
      (e) => { onFinally?.(); throw e; },
    );
  }
}

export const db = {
  from(table) {
    return new QueryBuilder(table);
  },

  // The cloud build kept three stored procedures. Two are reimplemented in
  // lib/rpc.js; exec_sql (arbitrary DDL over HTTP) is deliberately not carried
  // over — a local app has no business executing caller-supplied schema changes.
  async rpc(name, args = {}) {
    const { runRpc } = await import('./rpc.js');
    return runRpc(name, args);
  },
};

export default db;
