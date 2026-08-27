import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { MAX_PERSISTED_PROJECTION_BYTES, PERSISTENCE_SCHEMA_VERSION } from './constants'
import { serializeProjection } from './redaction'

const MAX_RECORD_ID_LENGTH = 160
const MAX_LIST_SIZE = 100
const SQLITE_BUSY_TIMEOUT_MS = 5_000

type SqliteRow = Record<string, unknown>

export interface StoredProjection {
  id: string
  namespace: string
  projection: unknown
  createdAt: string
  updatedAt: string
}

export interface WorkspaceCounts {
  scenarios: number
  correctionDrafts: number
  regressionCases: number
  sourcePackets: number
}

export interface WorkspaceBootstrap {
  schemaVersion: number
  counts: WorkspaceCounts
}

/**
 * Main-process-only persistence. Renderer code never receives a database
 * handle and all writes are serialized through this store's queue.
 */
export class WorkspaceStore {
  private database: DatabaseSync | undefined
  private writeQueue: Promise<void> = Promise.resolve()
  private readonly redactionSecrets = new Set<string>()

  public constructor(private readonly databasePath: string) {}

  public open(): void {
    if (this.database) return

    mkdirSync(dirname(this.databasePath), { recursive: true })
    const database = new DatabaseSync(this.databasePath, {
      allowExtension: false,
      enableForeignKeyConstraints: true,
      timeout: SQLITE_BUSY_TIMEOUT_MS,
    })
    database.exec('PRAGMA journal_mode = WAL;')
    database.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`)
    database.exec('PRAGMA foreign_keys = ON;')
    database.exec('PRAGMA synchronous = FULL;')
    database.exec('PRAGMA trusted_schema = OFF;')

    const quickCheck = database.prepare('PRAGMA quick_check').get() as SqliteRow | undefined
    const quickCheckValue = String(quickCheck?.quick_check ?? quickCheck?.['quick_check(10)'] ?? '')
    if (quickCheckValue !== 'ok') {
      database.close()
      throw new Error('Local workspace database quick_check failed')
    }

    database.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_records (
        namespace TEXT NOT NULL,
        record_id TEXT NOT NULL,
        projection TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (namespace, record_id)
      );

      CREATE INDEX IF NOT EXISTS workspace_records_namespace_updated
        ON workspace_records (namespace, updated_at DESC);
    `)

    const existingVersion = database
      .prepare('SELECT value FROM app_meta WHERE key = ?')
      .get('schema_version') as SqliteRow | undefined
    if (existingVersion?.value && Number(existingVersion.value) > PERSISTENCE_SCHEMA_VERSION) {
      database.close()
      throw new Error('Unsupported local workspace schema version')
    }

    database
      .prepare(
        `INSERT INTO app_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run('schema_version', String(PERSISTENCE_SCHEMA_VERSION))

    this.database = database
  }

  public close(): void {
    this.database?.close()
    this.database = undefined
  }

  /** Register a main-process secret for projection-wide redaction. */
  public registerRedactionSecret(secret: string | undefined): void {
    if (typeof secret === 'string' && secret.length >= 4) this.redactionSecrets.add(secret)
  }

  public bootstrap(): WorkspaceBootstrap {
    const database = this.requireDatabase()
    const count = (namespace: string): number => {
      const row = database
        .prepare('SELECT COUNT(*) AS count FROM workspace_records WHERE namespace = ?')
        .get(namespace) as SqliteRow | undefined
      return typeof row?.count === 'number' ? row.count : Number(row?.count ?? 0)
    }

    return {
      schemaVersion: PERSISTENCE_SCHEMA_VERSION,
      counts: {
        scenarios: count('scenario'),
        correctionDrafts: count('correction-draft'),
        regressionCases: count('regression'),
        sourcePackets: count('source-packet'),
      },
    }
  }

  public read(namespace: string, id: string): StoredProjection | undefined {
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const row = this.requireDatabase()
      .prepare(
        `SELECT namespace, record_id, projection, created_at, updated_at
         FROM workspace_records
         WHERE namespace = ? AND record_id = ?`,
      )
      .get(normalizedNamespace, this.normalizeId(id)) as SqliteRow | undefined
    return row ? this.rowToProjection(row) : undefined
  }

  public list(namespace: string, limit = MAX_LIST_SIZE): StoredProjection[] {
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), MAX_LIST_SIZE)
    const rows = this.requireDatabase()
      .prepare(
        `SELECT namespace, record_id, projection, created_at, updated_at
         FROM workspace_records
         WHERE namespace = ?
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(normalizedNamespace, safeLimit) as SqliteRow[]
    return rows.map((row) => this.rowToProjection(row))
  }

  public write(
    namespace: string,
    id: string | undefined,
    value: unknown,
  ): Promise<StoredProjection> {
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const normalizedId = this.normalizeId(id ?? randomUUID())
    const projection = serializeProjection(value, MAX_PERSISTED_PROJECTION_BYTES, [
      ...this.redactionSecrets,
    ])
    const now = new Date().toISOString()

    return this.enqueueWrite(() => {
      const database = this.requireDatabase()
      database
        .prepare(
          `INSERT INTO workspace_records
             (namespace, record_id, projection, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(namespace, record_id) DO UPDATE SET
             projection = excluded.projection,
             updated_at = excluded.updated_at`,
        )
        .run(normalizedNamespace, normalizedId, projection, now, now)

      return {
        id: normalizedId,
        namespace: normalizedNamespace,
        projection: this.parseProjection(projection),
        createdAt: now,
        updatedAt: now,
      }
    })
  }

  public remove(namespace: string, id: string): Promise<void> {
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const normalizedId = this.normalizeId(id)
    return this.enqueueWrite(() => {
      this.requireDatabase()
        .prepare('DELETE FROM workspace_records WHERE namespace = ? AND record_id = ?')
        .run(normalizedNamespace, normalizedId)
    })
  }

  private enqueueWrite<T>(operation: () => T): Promise<T> {
    const result = this.writeQueue.then(operation)
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database) throw new Error('Workspace store is not open')
    return this.database
  }

  private normalizeNamespace(namespace: string): string {
    const normalized = namespace.trim().slice(0, 80)
    if (!/^[a-z0-9-]+$/u.test(normalized)) throw new Error('Invalid workspace namespace')
    return normalized
  }

  private normalizeId(id: string): string {
    const normalized = id.trim().slice(0, MAX_RECORD_ID_LENGTH)
    if (!normalized) throw new Error('Workspace record id is required')
    return normalized
  }

  private rowToProjection(row: SqliteRow): StoredProjection {
    const namespace = String(row.namespace ?? '')
    const id = String(row.record_id ?? '')
    const projection = String(row.projection ?? 'null')
    return {
      id,
      namespace,
      projection: this.parseProjection(projection),
      createdAt: String(row.created_at ?? ''),
      updatedAt: String(row.updated_at ?? ''),
    }
  }

  private parseProjection(projection: string): unknown {
    try {
      return JSON.parse(projection) as unknown
    } catch {
      return { truncated: true, reason: 'invalid-persisted-projection' }
    }
  }
}
