/**
 * A tiny in-memory stand-in for the Supabase query builder: enough of select / insert / update /
 * delete with eq / in filters and single / maybeSingle, so server actions can be tested on outcomes.
 */
type Row = Record<string, unknown>;
type Result = { data: unknown; error: null | { message: string } };

export class FakeDb {
  tables: Record<string, Row[]> = {};
  rpcCalls: { fn: string; args: Row }[] = [];
  rpc = async (fn: string, args: Row): Promise<Result> => {
    this.rpcCalls.push({ fn, args });
    return { data: null, error: null };
  };

  /** Stand-in for Supabase Storage: bucket → set of object paths. */
  objects: Record<string, Set<string>> = {};
  storage = {
    from: (bucket: string) => {
      this.objects[bucket] ??= new Set();
      const set = this.objects[bucket];
      return {
        list: async (folder: string, opts?: { limit?: number }) => {
          const names = [...set].filter((p) => p.startsWith(`${folder}/`)).map((p) => p.slice(folder.length + 1)).filter((n) => !n.includes("/"));
          return { data: names.slice(0, opts?.limit ?? 100).map((name) => ({ name })), error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) set.delete(p);
          return { data: paths.map((name) => ({ name })), error: null };
        },
      };
    },
  };

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [t, rows] of Object.entries(seed)) this.tables[t] = rows.map((r) => ({ ...r }));
  }

  from(table: string) {
    this.tables[table] ??= [];
    return new Query(this.tables[table], table);
  }
}

let nextId = 1;

class Query implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private conflictKeys: string[] = [];
  private payload: Row | Row[] = {};

  constructor(
    private rows: Row[],
    private table: string,
  ) {}

  select() {
    return this;
  }
  insert(values: Row | Row[]) {
    this.op = "insert";
    this.payload = values;
    return this;
  }
  upsert(values: Row, opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = values;
    this.conflictKeys = (opts?.onConflict ?? "id").split(",").map((k) => k.trim());
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.payload = values;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  in(col: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  /** Only `.not(col, "is", null)` (is not null) is needed so far. */
  not(col: string, op: string, value: unknown) {
    if (op === "is" && value === null) this.filters.push((r) => r[col] !== null && r[col] !== undefined);
    else this.filters.push((r) => r[col] !== value);
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }

  /** Copies, like a real database response, so callers can't see later writes through them. */
  private run(): Row[] {
    return this.exec().map((r) => ({ ...r }));
  }

  private exec(): Row[] {
    const match = (r: Row) => this.filters.every((f) => f(r));
    if (this.op === "insert") {
      const values = Array.isArray(this.payload) ? (this.payload as Row[]) : [this.payload];
      const rows = values.map((v) => ({ id: `id-${nextId++}`, invite_token: `tok-${nextId}`, ...v }));
      this.rows.push(...rows);
      return rows;
    }
    if (this.op === "upsert") {
      const v = this.payload as Row;
      const hit = this.rows.find((r) => this.conflictKeys.every((k) => r[k] === v[k]));
      if (hit) {
        Object.assign(hit, v);
        return [hit];
      }
      const row = { id: `id-${nextId++}`, ...v };
      this.rows.push(row);
      return [row];
    }
    if (this.op === "update") {
      const hit = this.rows.filter(match);
      for (const r of hit) Object.assign(r, this.payload);
      return hit;
    }
    if (this.op === "delete") {
      const hit = this.rows.filter(match);
      for (const r of hit) this.rows.splice(this.rows.indexOf(r), 1);
      return hit;
    }
    return this.rows.filter(match);
  }

  async single(): Promise<Result> {
    const rows = this.run();
    return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `${this.table}: expected 1 row` } };
  }

  async maybeSingle(): Promise<Result> {
    return { data: this.run()[0] ?? null, error: null };
  }

  then<A = Result, B = never>(
    ok?: ((v: Result) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve<Result>({ data: this.run(), error: null }).then(ok, fail);
  }
}
