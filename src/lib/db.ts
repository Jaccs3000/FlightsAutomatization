import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { DEFAULT_SETTINGS, type AppSettings, type FlightPriceResult, type FollowUp, type FollowUpInput, type RunRecord, type RunStatus, type RunWithResults } from "./types";

type DbRow = Record<string, unknown>;

let database: Promise<{ instance: DuckDBInstance; connection: DuckDBConnection }> | null = null;
let queue = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

function databasePath() {
  return path.join(process.cwd(), "data", "vuela.duckdb");
}

async function openDatabase() {
  await mkdir(path.dirname(databasePath()), { recursive: true });
  const instance = await DuckDBInstance.fromCache(databasePath(), { threads: "2" });
  const connection = await instance.connect();
  await connection.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      singleton INTEGER PRIMARY KEY,
      recipient_email VARCHAR NOT NULL,
      schedule_times_json VARCHAR NOT NULL,
      history_retention_days INTEGER NOT NULL,
      sender_email VARCHAR,
      scheduler_enabled BOOLEAN NOT NULL,
      oauth_client_id VARCHAR,
      oauth_client_secret VARCHAR,
      updated_at VARCHAR NOT NULL
    )
  `);
  const settingsColumns = await connection.runAndReadAll("SELECT column_name FROM information_schema.columns WHERE table_name = 'app_settings'");
  const settingsColumnNames = new Set((settingsColumns.getRowObjectsJS() as Array<{ column_name: string }>).map((row) => row.column_name));
  if (settingsColumnNames.has("gmail_account_email") && !settingsColumnNames.has("sender_email")) {
    await connection.run("ALTER TABLE app_settings RENAME COLUMN gmail_account_email TO sender_email");
  }
  await connection.run(`
    INSERT INTO app_settings
      (singleton, recipient_email, schedule_times_json, history_retention_days, sender_email, scheduler_enabled, oauth_client_id, oauth_client_secret, updated_at)
    SELECT 1, '', '["08:00","13:00","21:00"]', 5, NULL, TRUE, NULL, NULL, $created_at
    WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE singleton = 1)
  `, { created_at: new Date().toISOString() });
  await connection.run(`
    CREATE TABLE IF NOT EXISTS follow_ups (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      origin_iata VARCHAR NOT NULL,
      destination_iata VARCHAR NOT NULL,
      trip_type VARCHAR NOT NULL,
      outbound_mode VARCHAR NOT NULL,
      outbound_start VARCHAR NOT NULL,
      outbound_end VARCHAR,
      inbound_mode VARCHAR,
      inbound_start VARCHAR,
      inbound_end VARCHAR,
      stay_nights INTEGER,
      adults INTEGER NOT NULL,
      max_price_cop BIGINT NOT NULL,
      status VARCHAR NOT NULL,
      created_at VARCHAR NOT NULL,
      updated_at VARCHAR NOT NULL
    )
  `);
  await connection.run(`
    CREATE TABLE IF NOT EXISTS runs (
      id VARCHAR PRIMARY KEY,
      batch_id VARCHAR NOT NULL,
      follow_up_id VARCHAR,
      follow_up_name VARCHAR NOT NULL,
      run_type VARCHAR NOT NULL,
      scheduled_at VARCHAR,
      status VARCHAR NOT NULL,
      started_at VARCHAR NOT NULL,
      finished_at VARCHAR,
      error VARCHAR,
      result_count INTEGER NOT NULL DEFAULT 0,
      notification_status VARCHAR NOT NULL DEFAULT 'not_needed',
      snapshot_json VARCHAR NOT NULL
    )
  `);
  await connection.run("ALTER TABLE runs ADD COLUMN IF NOT EXISTS scheduled_at VARCHAR");
  await connection.run(`
    CREATE TABLE IF NOT EXISTS run_results (
      id VARCHAR PRIMARY KEY,
      run_id VARCHAR NOT NULL,
      outbound_date VARCHAR NOT NULL,
      inbound_date VARCHAR,
      amount BIGINT,
      currency VARCHAR,
      comparable BOOLEAN NOT NULL,
      meets_threshold BOOLEAN NOT NULL,
      observed_text VARCHAR NOT NULL,
      details VARCHAR,
      created_at VARCHAR NOT NULL
    )
  `);
  await connection.run(`
    CREATE TABLE IF NOT EXISTS email_notifications (
      id VARCHAR PRIMARY KEY,
      run_id VARCHAR NOT NULL,
      recipient VARCHAR NOT NULL,
      status VARCHAR NOT NULL,
      sent_at VARCHAR,
      error VARCHAR
    )
  `);
  await connection.run(`
    CREATE TABLE IF NOT EXISTS app_secrets (
      secret_key VARCHAR PRIMARY KEY,
      secret_value VARCHAR NOT NULL,
      updated_at VARCHAR NOT NULL
    )
  `);
  await connection.run(`
    CREATE TABLE IF NOT EXISTS diagnostic_logs (
      id VARCHAR PRIMARY KEY,
      created_at VARCHAR NOT NULL,
      area VARCHAR NOT NULL,
      event VARCHAR NOT NULL,
      outcome VARCHAR NOT NULL,
      message VARCHAR NOT NULL
    )
  `);
  const smtpCredential = await connection.runAndReadAll("SELECT 1 AS configured FROM app_secrets WHERE secret_key = 'secret:gmail_smtp_credentials' LIMIT 1");
  await connection.run("DELETE FROM app_secrets WHERE secret_key IN ('secret:gmail_oauth_client', 'secret:gmail_oauth_tokens', 'secret:microsoft_oauth_client', 'secret:microsoft_oauth_tokens')");
  await connection.run("UPDATE app_settings SET oauth_client_id = NULL, oauth_client_secret = NULL");
  if (smtpCredential.getRowObjectsJS().length === 0) await connection.run("UPDATE app_settings SET sender_email = NULL WHERE singleton = 1");
  return { instance, connection };
}

async function db() {
  if (!database) database = openDatabase();
  return database;
}

async function rows(sql: string, params?: Record<string, unknown>): Promise<DbRow[]> {
  return enqueue(async () => {
    const { connection } = await db();
    const reader = await connection.runAndReadAll(sql, params as never);
    return reader.getRowObjectsJS() as DbRow[];
  });
}

async function exec(sql: string, params?: Record<string, unknown>) {
  return enqueue(async () => {
    const { connection } = await db();
    await connection.run(sql, params as never);
  });
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function asNullableString(value: unknown): string | null {
  return value == null ? null : asString(value);
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function toFollowUp(row: DbRow): FollowUp {
  return {
    id: asString(row.id), name: asString(row.name), originIata: asString(row.origin_iata),
    destinationIata: asString(row.destination_iata), tripType: asString(row.trip_type) as FollowUp["tripType"],
    outboundMode: asString(row.outbound_mode) as FollowUp["outboundMode"], outboundStart: asString(row.outbound_start),
    outboundEnd: asNullableString(row.outbound_end), inboundMode: asNullableString(row.inbound_mode) as FollowUp["inboundMode"],
    inboundStart: asNullableString(row.inbound_start), inboundEnd: asNullableString(row.inbound_end),
    stayNights: row.stay_nights == null ? null : asNumber(row.stay_nights), adults: asNumber(row.adults),
    maxPriceCop: asNumber(row.max_price_cop), status: asString(row.status) as FollowUp["status"],
    createdAt: asString(row.created_at), updatedAt: asString(row.updated_at),
  };
}

export async function initializeDatabase() {
  await db();
}

export async function listFollowUps(): Promise<FollowUp[]> {
  return (await rows("SELECT * FROM follow_ups ORDER BY created_at DESC")).map(toFollowUp);
}

export async function getFollowUp(id: string): Promise<FollowUp | null> {
  const result = await rows("SELECT * FROM follow_ups WHERE id = $id", { id });
  return result[0] ? toFollowUp(result[0]) : null;
}

export async function saveFollowUp(input: FollowUpInput, existingId?: string): Promise<FollowUp> {
  const id = existingId ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const existing = existingId ? await getFollowUp(existingId) : null;
  await exec(`
    INSERT OR REPLACE INTO follow_ups
      (id, name, origin_iata, destination_iata, trip_type, outbound_mode, outbound_start, outbound_end,
       inbound_mode, inbound_start, inbound_end, stay_nights, adults, max_price_cop, status, created_at, updated_at)
    VALUES ($id, $name, $origin_iata, $destination_iata, $trip_type, $outbound_mode, $outbound_start, $outbound_end,
       $inbound_mode, $inbound_start, $inbound_end, $stay_nights, $adults, $max_price_cop, $status, $created_at, $updated_at)
  `, {
    id, name: input.name, origin_iata: input.originIata, destination_iata: input.destinationIata,
    trip_type: input.tripType, outbound_mode: input.outboundMode, outbound_start: input.outboundStart,
    outbound_end: input.outboundMode === "flexible" ? input.outboundEnd ?? null : null,
    inbound_mode: input.tripType === "round_trip" ? input.inboundMode ?? null : null,
    inbound_start: input.tripType === "round_trip" ? input.inboundStart ?? null : null,
    inbound_end: input.tripType === "round_trip" && input.inboundMode === "flexible" ? input.inboundEnd ?? null : null,
    stay_nights: input.tripType === "round_trip" ? input.stayNights ?? null : null,
    adults: input.adults, max_price_cop: input.maxPriceCop, status: input.status,
    created_at: existing?.createdAt ?? now, updated_at: now,
  });
  return (await getFollowUp(id))!;
}

export async function setFollowUpStatus(id: string, status: FollowUp["status"]): Promise<boolean> {
  const existing = await getFollowUp(id);
  if (!existing) return false;
  await exec("UPDATE follow_ups SET status = $status, updated_at = $updated_at WHERE id = $id", { id, status, updated_at: new Date().toISOString() });
  return true;
}

export async function deleteFollowUp(id: string): Promise<boolean> {
  const existing = await getFollowUp(id);
  if (!existing) return false;
  await exec("DELETE FROM follow_ups WHERE id = $id", { id });
  return true;
}

export async function getSettings(): Promise<AppSettings> {
  const result = await rows("SELECT * FROM app_settings WHERE singleton = 1");
  const row = result[0];
  if (!row) return DEFAULT_SETTINGS;
  return {
    recipientEmail: asString(row.recipient_email),
    scheduleTimes: JSON.parse(asString(row.schedule_times_json, "[]")) as string[],
    historyRetentionDays: asNumber(row.history_retention_days),
    senderEmail: asNullableString(row.sender_email),
    schedulerEnabled: asBoolean(row.scheduler_enabled),
  };
}

export async function saveSettings(settings: Partial<AppSettings>) {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  await exec(`
    UPDATE app_settings SET recipient_email = $recipient_email, schedule_times_json = $schedule_times_json,
      history_retention_days = $history_retention_days, sender_email = $sender_email,
      scheduler_enabled = $scheduler_enabled, oauth_client_id = $oauth_client_id,
      oauth_client_secret = $oauth_client_secret, updated_at = $updated_at
    WHERE singleton = 1
  `, {
    recipient_email: merged.recipientEmail,
    schedule_times_json: JSON.stringify(merged.scheduleTimes),
    history_retention_days: merged.historyRetentionDays,
    sender_email: merged.senderEmail,
    scheduler_enabled: merged.schedulerEnabled,
    oauth_client_id: "",
    oauth_client_secret: "",
    updated_at: new Date().toISOString(),
  });
}

export async function updateSenderEmail(email: string | null) {
  await exec("UPDATE app_settings SET sender_email = $email, updated_at = $updated_at WHERE singleton = 1", { email, updated_at: new Date().toISOString() });
}

export async function getAppSecret(key: string): Promise<string | null> {
  const result = await rows("SELECT secret_value FROM app_secrets WHERE secret_key = $key", { key });
  return result[0] ? asString(result[0].secret_value) : null;
}

export async function setAppSecret(key: string, value: string | null) {
  if (value === null) {
    await exec("DELETE FROM app_secrets WHERE secret_key = $key", { key });
    return;
  }
  await exec("INSERT OR REPLACE INTO app_secrets (secret_key, secret_value, updated_at) VALUES ($key, $value, $updated_at)", { key, value, updated_at: new Date().toISOString() });
}

export async function resetAppSecrets() {
  return enqueue(async () => {
    const { connection } = await db();
    await connection.run("BEGIN TRANSACTION");
    try {
      await connection.run("DELETE FROM app_secrets");
      await connection.run("UPDATE app_settings SET sender_email = NULL, oauth_client_id = NULL, oauth_client_secret = NULL, updated_at = $updated_at WHERE singleton = 1", { updated_at: new Date().toISOString() });
      await connection.run("COMMIT");
    } catch (error) {
      await connection.run("ROLLBACK");
      throw error;
    }
  });
}

export interface DiagnosticLog {
  id: string;
  createdAt: string;
  area: string;
  event: string;
  outcome: "info" | "success" | "warning" | "error";
  message: string;
}

export async function appendDiagnosticLog(entry: Omit<DiagnosticLog, "id" | "createdAt">) {
  const createdAt = new Date().toISOString();
  await exec("INSERT INTO diagnostic_logs (id, created_at, area, event, outcome, message) VALUES ($id, $created_at, $area, $event, $outcome, $message)", {
    id: crypto.randomUUID(), created_at: createdAt, area: entry.area, event: entry.event,
    outcome: entry.outcome, message: entry.message.slice(0, 500),
  });
  await exec("DELETE FROM diagnostic_logs WHERE id NOT IN (SELECT id FROM diagnostic_logs ORDER BY created_at DESC, id DESC LIMIT 500)");
}

export async function listDiagnosticLogs(limit = 200): Promise<DiagnosticLog[]> {
  const result = await rows("SELECT id, created_at, area, event, outcome, message FROM diagnostic_logs ORDER BY created_at DESC, id DESC LIMIT $limit", { limit: Math.min(500, Math.max(1, Math.trunc(limit))) });
  return result.map((row) => ({
    id: asString(row.id), createdAt: asString(row.created_at), area: asString(row.area),
    event: asString(row.event), outcome: asString(row.outcome) as DiagnosticLog["outcome"], message: asString(row.message),
  }));
}

export async function createRun(data: { id: string; batchId: string; followUp: FollowUp; runType: "scheduled" | "manual"; scheduledAt?: string | null; startedAt: string }): Promise<void> {
  await exec(`
    INSERT INTO runs (id, batch_id, follow_up_id, follow_up_name, run_type, scheduled_at, status, started_at, snapshot_json)
    VALUES ($id, $batch_id, $follow_up_id, $follow_up_name, $run_type, $scheduled_at, 'running', $started_at, $snapshot_json)
  `, {
    id: data.id, batch_id: data.batchId, follow_up_id: data.followUp.id,
    follow_up_name: data.followUp.name, run_type: data.runType, started_at: data.startedAt,
    scheduled_at: data.scheduledAt ?? null,
    snapshot_json: JSON.stringify(data.followUp),
  });
}

export async function finishRun(data: { id: string; status: RunStatus; finishedAt: string; error?: string | null; results: FlightPriceResult[]; notificationStatus?: RunRecord["notificationStatus"] }) {
  return enqueue(async () => {
    const { connection } = await db();
    await connection.run("BEGIN TRANSACTION");
    try {
      for (const result of data.results) {
        await connection.run(`
          INSERT INTO run_results (id, run_id, outbound_date, inbound_date, amount, currency, comparable, meets_threshold, observed_text, details, created_at)
          VALUES ($id, $run_id, $outbound_date, $inbound_date, $amount, $currency, $comparable, $meets_threshold, $observed_text, $details, $created_at)
        `, {
          id: crypto.randomUUID(), run_id: data.id, outbound_date: result.outboundDate, inbound_date: result.inboundDate,
          amount: result.amount, currency: result.currency, comparable: result.comparable, meets_threshold: result.meetsThreshold,
          observed_text: result.observedText, details: result.details, created_at: data.finishedAt,
        } as never);
      }
      await connection.run(`
        UPDATE runs SET status = $status, finished_at = $finished_at, error = $error,
          result_count = $result_count, notification_status = $notification_status WHERE id = $id
      `, {
        id: data.id, status: data.status, finished_at: data.finishedAt, error: data.error ?? null,
        result_count: data.results.length, notification_status: data.notificationStatus ?? "not_needed",
      } as never);
      await connection.run("COMMIT");
    } catch (error) {
      await connection.run("ROLLBACK");
      throw error;
    }
  });
}

export async function setRunNotification(id: string, status: RunRecord["notificationStatus"], recipient: string, error?: string) {
  await enqueue(async () => {
    const { connection } = await db();
    await connection.run("BEGIN TRANSACTION");
    try {
      await connection.run("UPDATE runs SET notification_status = $status WHERE id = $id", { id, status } as never);
      await connection.run(`
        INSERT INTO email_notifications (id, run_id, recipient, status, sent_at, error)
        VALUES ($notification_id, $run_id, $recipient, $status, $sent_at, $error)
      `, {
        notification_id: crypto.randomUUID(), run_id: id, recipient, status,
        sent_at: status === "sent" ? new Date().toISOString() : null, error: error ?? null,
      } as never);
      await connection.run("COMMIT");
    } catch (caught) {
      await connection.run("ROLLBACK");
      throw caught;
    }
  });
}

export async function addSkippedRun(data: { batchId: string; followUp: FollowUp; scheduledAt?: string | null; startedAt: string; reason: string }) {
  await exec(`
    INSERT INTO runs (id, batch_id, follow_up_id, follow_up_name, run_type, scheduled_at, status, started_at, finished_at, error, result_count, notification_status, snapshot_json)
    VALUES ($id, $batch_id, $follow_up_id, $follow_up_name, 'scheduled', $scheduled_at, 'skipped_overlap', $started_at, $finished_at, $error, 0, 'not_needed', $snapshot_json)
  `, {
    id: crypto.randomUUID(), batch_id: data.batchId, follow_up_id: data.followUp.id, follow_up_name: data.followUp.name,
    scheduled_at: data.scheduledAt ?? null, started_at: data.startedAt, finished_at: new Date().toISOString(), error: data.reason, snapshot_json: JSON.stringify(data.followUp),
  });
}

export async function listRuns(limit = 100): Promise<RunWithResults[]> {
  const runRows = await rows("SELECT * FROM runs ORDER BY started_at DESC LIMIT $limit", { limit });
  if (runRows.length === 0) return [];
  const ids = runRows.map((row) => `'${String(row.id).replaceAll("'", "''")}'`).join(",");
  const resultRows = await rows(`SELECT * FROM run_results WHERE run_id IN (${ids}) ORDER BY outbound_date, inbound_date`);
  const notificationRows = await rows(`SELECT * FROM email_notifications WHERE run_id IN (${ids})`);
  const resultsByRun = new Map<string, FlightPriceResult[]>();
  const notificationsByRun = new Map<string, DbRow>();
  for (const row of notificationRows) notificationsByRun.set(asString(row.run_id), row);
  for (const row of resultRows) {
    const runId = asString(row.run_id);
    const bucket = resultsByRun.get(runId) ?? [];
    bucket.push({
      outboundDate: asString(row.outbound_date), inboundDate: asNullableString(row.inbound_date),
      amount: row.amount == null ? null : asNumber(row.amount), currency: asNullableString(row.currency),
      comparable: asBoolean(row.comparable), meetsThreshold: asBoolean(row.meets_threshold),
      observedText: asString(row.observed_text), details: asNullableString(row.details),
    });
    resultsByRun.set(runId, bucket);
  }
  return runRows.map((row) => {
    const notification = notificationsByRun.get(asString(row.id));
    return {
    id: asString(row.id), batchId: asString(row.batch_id), followUpId: asString(row.follow_up_id),
    followUpName: asString(row.follow_up_name), snapshot: parseFollowUpSnapshot(asString(row.snapshot_json)),
    runType: asString(row.run_type) as RunRecord["runType"],
    scheduledAt: asNullableString(row.scheduled_at),
    status: asString(row.status) as RunStatus, startedAt: asString(row.started_at), finishedAt: asNullableString(row.finished_at),
    error: asNullableString(row.error), resultCount: asNumber(row.result_count),
    notificationStatus: asString(row.notification_status) as RunRecord["notificationStatus"],
    notificationRecipient: notification ? asNullableString(notification.recipient) : null,
    notificationSentAt: notification ? asNullableString(notification.sent_at) : null,
    notificationError: notification ? asNullableString(notification.error) : null,
    results: resultsByRun.get(asString(row.id)) ?? [],
  };
  });
}

function parseFollowUpSnapshot(value: string): FollowUp | null {
  try { return JSON.parse(value) as FollowUp; }
  catch { return null; }
}

export async function pruneHistory(retentionDays: number) {
  return enqueue(async () => {
    const { connection } = await db();
    await connection.run("BEGIN TRANSACTION");
    try {
      const oldRows = await connection.runAndReadAll("SELECT id FROM runs WHERE try_cast(started_at AS TIMESTAMP) < now() - ($days * INTERVAL '1 day')", { days: retentionDays });
      const ids = (oldRows.getRowObjectsJS() as DbRow[]).map((row) => asString(row.id));
      for (const id of ids) {
        await connection.run("DELETE FROM run_results WHERE run_id = $id", { id } as never);
        await connection.run("DELETE FROM email_notifications WHERE run_id = $id", { id } as never);
        await connection.run("DELETE FROM runs WHERE id = $id", { id } as never);
      }
      await connection.run("COMMIT");
      return ids.length;
    } catch (error) {
      await connection.run("ROLLBACK");
      throw error;
    }
  });
}
