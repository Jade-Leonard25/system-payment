import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";

const GENESIS_HASH = "0";
const MAX_APPEND_ATTEMPTS = 8;

export type AuditEventInput = {
  companyId: string;
  actorId: string | null;
  ipAddress?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  requestId?: string;
  occurredAt?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
};

type AuditHashFields = {
  companyId: string;
  sequence: number;
  actorId: string | null;
  occurredAt: string;
  ipAddress: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string;
  beforeJson: string | null;
  afterJson: string | null;
  metadataJson: string;
  previousHash: string;
};

type AuditHead = { last_sequence: number; last_hash: string };
export type AuditMutation = {
  companyId: string;
  statement: D1PreparedStatement;
  expectedChanges: number;
};

type AuditRow = AuditHashFields & {
  id: string;
  entry_hash: string;
};

export function auditRequestMetadata(headers: Headers) {
  return {
    ipAddress: headers.get("cf-connecting-ip"),
    requestId:
      headers.get("cf-ray") ??
      headers.get("x-request-id") ??
      crypto.randomUUID(),
  };
}

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object") {
    const result = JSON.stringify(value);
    if (result === undefined) throw new Error("Audit values must be JSON serializable.");
    return result;
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

async function hashFields(fields: AuditHashFields): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableJson(fields)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function serializeOptional(value: unknown): string | null {
  return value === undefined ? null : stableJson(value);
}

export async function appendAuditEvent(
  database: D1Database,
  input: AuditEventInput,
  mutations: AuditMutation[] = [],
): Promise<{ id: string; sequence: number; entryHash: string }> {
  const [result] = await appendAuditEvents(database, [input], mutations);
  if (!result) throw new Error("Audit service did not return the appended event.");
  return result;
}

export async function appendAuditEvents(
  database: D1Database,
  inputs: AuditEventInput[],
  mutations: AuditMutation[] = [],
): Promise<{ id: string; sequence: number; entryHash: string }[]> {
  if (inputs.length === 0) throw new Error("At least one audit event is required.");
  const companyIds = new Set<string>();
  const normalizedInputs = inputs.map((input) => {
    if (!input.companyId || !input.action || !input.resourceType) {
      throw new Error("Audit events require a company, action, and resource type.");
    }
    if (companyIds.has(input.companyId)) {
      throw new Error("A single audit transaction can append only one event per company.");
    }
    companyIds.add(input.companyId);
    return {
      ...input,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      requestId: input.requestId ?? crypto.randomUUID(),
    };
  });
  if (mutations.some(({ companyId }) => !companyIds.has(companyId))) {
    throw new Error("Audited mutations must be scoped to an event company.");
  }
  if (
    mutations.some(
      ({ expectedChanges }) =>
        !Number.isInteger(expectedChanges) || expectedChanges < 1,
    )
  ) {
    throw new Error("Audited mutations must declare a positive expected row count.");
  }

  for (const companyId of companyIds) {
    await database
      .prepare(
        `INSERT OR IGNORE INTO company_audit_heads
          (company_id, last_sequence, last_hash) VALUES (?, 0, ?)`,
      )
      .bind(companyId, GENESIS_HASH)
      .run();
  }

  for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
    const heads = await Promise.all(
      normalizedInputs.map(async (input) => {
        const head = await database
          .prepare(
            `SELECT last_sequence, last_hash
             FROM company_audit_heads
             WHERE company_id = ?`,
          )
          .bind(input.companyId)
          .first<AuditHead>();
        if (!head) throw new Error("Audit chain head is missing for this company.");
        return { input, head };
      }),
    );
    const records = await Promise.all(
      heads.map(async ({ input, head }) => {
        const sequence = head.last_sequence + 1;
        const fields: AuditHashFields = {
          companyId: input.companyId,
          sequence,
          actorId: input.actorId,
          occurredAt: input.occurredAt,
          ipAddress: input.ipAddress ?? null,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId ?? null,
          requestId: input.requestId,
          beforeJson: serializeOptional(input.before),
          afterJson: serializeOptional(input.after),
          metadataJson: stableJson(input.metadata ?? {}),
          previousHash: head.last_hash,
        };
        return {
          fields,
          id: crypto.randomUUID(),
          entryHash: await hashFields(fields),
          previousSequence: head.last_sequence,
          previousHash: head.last_hash,
        };
      }),
    );

    const statements: D1PreparedStatement[] = [];
    const guardIds: { companyId: string; guardId: string }[] = [];
    const headUpdateIndexes: number[] = [];
    const eventInsertIndexes: number[] = [];
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record) throw new Error("Audit transaction lost a prepared event.");
      const { fields, entryHash, previousSequence, previousHash } = record;
      headUpdateIndexes.push(statements.length);
      statements.push(
        database
          .prepare(
            `UPDATE company_audit_heads
             SET last_sequence = ?, last_hash = ?
             WHERE company_id = ? AND last_sequence = ? AND last_hash = ?`,
          )
          .bind(
            fields.sequence,
            entryHash,
            fields.companyId,
            previousSequence,
            previousHash,
          ),
      );
      const guardId = crypto.randomUUID();
      guardIds.push({ companyId: fields.companyId, guardId });
      statements.push(
        database
          .prepare(
            `INSERT INTO company_audit_write_guards
              (company_id, guard_id, cas_result, mutation_result)
             VALUES (?, ?, changes(), NULL)`,
          )
          .bind(fields.companyId, guardId),
      );
    }
    for (const mutation of mutations) {
      const guardId = crypto.randomUUID();
      const companyId = mutation.companyId;
      guardIds.push({ companyId, guardId });
      statements.push(mutation.statement);
      statements.push(
        database
          .prepare(
            `INSERT INTO company_audit_write_guards
              (company_id, guard_id, cas_result, mutation_result)
             VALUES (?, ?, NULL, CASE WHEN changes() = ? THEN 1 ELSE 0 END)`,
          )
          .bind(companyId, guardId, mutation.expectedChanges),
      );
    }
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record) throw new Error("Audit transaction lost a prepared event.");
      const { fields, id, entryHash } = record;
      eventInsertIndexes.push(statements.length);
      statements.push(
        database
          .prepare(
            `INSERT INTO company_audit_events (
               id, company_id, sequence, actor_id, occurred_at, ip_address,
               action, resource_type, resource_id, request_id, before_json,
               after_json, metadata_json, previous_hash, entry_hash
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM company_audit_heads
               WHERE company_id = ? AND last_sequence = ? AND last_hash = ?
             )`,
          )
          .bind(
            id,
            fields.companyId,
            fields.sequence,
            fields.actorId,
            fields.occurredAt,
            fields.ipAddress,
            fields.action,
            fields.resourceType,
            fields.resourceId,
            fields.requestId,
            fields.beforeJson,
            fields.afterJson,
            fields.metadataJson,
            fields.previousHash,
            entryHash,
            fields.companyId,
            fields.sequence,
            entryHash,
          ),
      );
    }
    const cleanupIndexes: number[] = [];
    for (const { companyId, guardId } of guardIds) {
      cleanupIndexes.push(statements.length);
      statements.push(
        database
          .prepare(
            `DELETE FROM company_audit_write_guards
             WHERE company_id = ? AND guard_id = ?`,
          )
          .bind(companyId, guardId),
      );
    }

    let results;
    try {
      results = await database.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("cas_result")) continue;
      throw error;
    }

    const updatesSucceeded = headUpdateIndexes.every(
      (index) => results[index]?.meta.changes === 1,
    );
    const eventsSucceeded = eventInsertIndexes.every(
      (index) => results[index]?.meta.changes === 1,
    );
    const cleanupSucceeded = cleanupIndexes.every(
      (index) => results[index]?.meta.changes === 1,
    );
    if (!updatesSucceeded || !eventsSucceeded || !cleanupSucceeded) {
      throw new Error("Audit transaction failed its atomic consistency check.");
    }
    return records.map(({ id, entryHash, fields }) => ({
      id,
      sequence: fields.sequence,
      entryHash,
    }));
  }

  throw new Error("Could not append audit event after concurrent chain updates.");
}

export async function verifyAuditChain(
  database: D1Database,
  companyId: string,
): Promise<{ valid: boolean; checked: number; error?: string }> {
  const [head, events] = await Promise.all([
    database
      .prepare(
        `SELECT last_sequence, last_hash
         FROM company_audit_heads
         WHERE company_id = ?`,
      )
      .bind(companyId)
      .first<AuditHead>(),
    database
      .prepare(
        `SELECT id, company_id AS companyId, sequence, actor_id AS actorId,
                occurred_at AS occurredAt, ip_address AS ipAddress, action,
                resource_type AS resourceType, resource_id AS resourceId,
                request_id AS requestId, before_json AS beforeJson,
                after_json AS afterJson, metadata_json AS metadataJson,
                previous_hash AS previousHash, entry_hash
         FROM company_audit_events
         WHERE company_id = ?
         ORDER BY sequence ASC`,
      )
      .bind(companyId)
      .all<AuditRow>(),
  ]);
  if (!head) {
    return { valid: false, checked: 0, error: "Audit chain head is missing." };
  }

  let expectedSequence = 1;
  let previousHash = GENESIS_HASH;
  for (const event of events.results) {
    if (event.sequence !== expectedSequence) {
      return {
        valid: false,
        checked: expectedSequence - 1,
        error: `Sequence gap or reordering at sequence ${expectedSequence}.`,
      };
    }
    if (event.previousHash !== previousHash) {
      return {
        valid: false,
        checked: expectedSequence - 1,
        error: `Previous hash mismatch at sequence ${expectedSequence}.`,
      };
    }
    const {
      id: _eventId,
      entry_hash: entryHash,
      ...fields
    } = event;
    const computedHash = await hashFields(fields);
    if (computedHash !== entryHash) {
      return {
        valid: false,
        checked: expectedSequence - 1,
        error: `Entry hash mismatch at sequence ${expectedSequence}.`,
      };
    }
    previousHash = entryHash;
    expectedSequence += 1;
  }

  const checked = events.results.length;
  if (
    head.last_sequence !== checked ||
    head.last_hash !== (checked === 0 ? GENESIS_HASH : previousHash)
  ) {
    return {
      valid: false,
      checked,
      error: "Audit chain head does not match the stored events.",
    };
  }
  return { valid: true, checked };
}
