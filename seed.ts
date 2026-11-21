import { unlink, writeFile } from "node:fs/promises";
import { hashProductKey, generateKeySegment, generateProductKey } from "./key-products";

const KEY_COUNT_PER_RUN = 1000;
const MAX_KEY_COUNT = 36 ** 3;
const BATCH_SIZE = 100;
const HASH_CONCURRENCY = 8;
const target = process.argv.includes("--remote") ? "--remote" : "--local";
const selectors = new Set<string>();
const seededKeys: string[] = [];
const escapeSql = (value: string) => value.replaceAll("'", "''");

async function createSeedRow() {
  let keySelector = generateKeySegment();
  while (selectors.has(keySelector)) {
    keySelector = generateKeySegment();
  }
  selectors.add(keySelector);

  const { key } = generateProductKey(keySelector);
  seededKeys.push(key);
  const keyHash = await hashProductKey(key);
  const id = crypto.randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);
  return `('${id}', '${keySelector}', '${key}', '${keyHash}', 'active', ${createdAt})`;
}

async function getExistingSelectors(): Promise<Set<string>> {
  const query = Bun.spawn(
    [
      "bunx",
      "wrangler",
      "d1",
      "execute",
      "system-payroll",
      target,
      "--json",
      "--command",
      "SELECT key_selector FROM key_product;",
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const outputPromise = new Response(query.stdout).text();
  const exitCode = await query.exited;
  const output = await outputPromise;
  if (exitCode !== 0) {
    throw new Error(`Unable to read existing product keys (Wrangler exit code ${exitCode})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Wrangler returned invalid JSON while reading existing product keys");
  }

  const result = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!result || typeof result !== "object") {
    throw new Error("Wrangler response did not contain product key selectors");
  }

  const response = result as {
    results?: Array<{ key_selector?: unknown }>;
  };
  const rows = response.results;
  if (!rows) {
    throw new Error("Wrangler response did not contain product key selectors");
  }
  return new Set(
    rows.flatMap((row) =>
      typeof row.key_selector === "string" ? [row.key_selector] : [],
    ),
  );
}

async function importExistingKeys(filePath: string) {
  const contents = await Bun.file(filePath).text();
  const keys = contents.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (keys.length === 0 || keys.some((key) => !/^[a-z0-9]{3}(?:-[a-z0-9]{3}){2}$/i.test(key))) {
    throw new Error("The key export is empty or contains an invalid key.");
  }

  const importedSelectors = new Set<string>();
  const statements: string[] = [];
  for (const key of keys) {
    const normalizedKey = key.toLowerCase();
    const selector = normalizedKey.slice(0, 3);
    if (importedSelectors.has(selector)) {
      throw new Error(`The key export contains duplicate selector ${selector}.`);
    }
    importedSelectors.add(selector);
    statements.push(
      `UPDATE key_product SET key_value = '${escapeSql(normalizedKey)}' WHERE key_selector = '${selector}';`,
    );
  }

  const tempFile = `/tmp/system-payment-key-import-${crypto.randomUUID()}.sql`;
  try {
    await Bun.write(tempFile, statements.join("\n"));
    const process = Bun.spawn(
      ["bunx", "wrangler", "d1", "execute", "system-payroll", target, "--file", tempFile],
      { stdout: "inherit", stderr: "inherit" },
    );
    const exitCode = await process.exited;
    if (exitCode !== 0) {
      throw new Error(`Wrangler D1 key import failed with exit code ${exitCode}`);
    }
    console.log(`Imported ${keys.length} keys into the database.`);
  } finally {
    await unlink(tempFile).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function main() {
  const importIndex = process.argv.indexOf("--import-existing");
  if (importIndex !== -1) {
    const filePath = process.argv[importIndex + 1];
    if (!filePath || filePath.startsWith("--")) {
      throw new Error("Usage: bun run seed --import-existing <keys-file> [--remote]");
    }
    const migration = Bun.spawn(
      ["bunx", "wrangler", "d1", "migrations", "apply", "system-payroll", target],
      { stdout: "inherit", stderr: "inherit" },
    );
    const migrationExitCode = await migration.exited;
    if (migrationExitCode !== 0) {
      throw new Error(`Wrangler D1 migration failed with exit code ${migrationExitCode}`);
    }
    await importExistingKeys(filePath);
    return;
  }

  const tempFile = `/tmp/system-payment-key-seed-${crypto.randomUUID()}.sql`;
  let tempFileCreated = false;
  try {
    const migration = Bun.spawn(
      ["bunx", "wrangler", "d1", "migrations", "apply", "system-payroll", target],
      { stdout: "inherit", stderr: "inherit" },
    );
    const migrationExitCode = await migration.exited;
    if (migrationExitCode !== 0) {
      throw new Error(`Wrangler D1 migration failed with exit code ${migrationExitCode}`);
    }

    const existingSelectors = await getExistingSelectors();
    if (existingSelectors.size + KEY_COUNT_PER_RUN > MAX_KEY_COUNT) {
      throw new Error(
        `Cannot add ${KEY_COUNT_PER_RUN} keys: ${existingSelectors.size} selectors already exist and the key format supports at most ${MAX_KEY_COUNT} unique selectors.`,
      );
    }

    for (const selector of existingSelectors) selectors.add(selector);

    const rows: string[] = [];
    for (let start = 0; start < KEY_COUNT_PER_RUN; start += BATCH_SIZE) {
      const batchSize = Math.min(BATCH_SIZE, KEY_COUNT_PER_RUN - start);
      const batch: string[] = [];
      for (let offset = 0; offset < batchSize; offset += HASH_CONCURRENCY) {
        const rowCount = Math.min(HASH_CONCURRENCY, batchSize - offset);
        batch.push(...await Promise.all(Array.from({ length: rowCount }, createSeedRow)));
      }
      rows.push(
        `INSERT INTO key_product (id, key_selector, key_value, key_hash, status, created_at) VALUES ${batch.join(", ")};`,
      );
    }

    await Bun.write(tempFile, rows.join("\n"));
    tempFileCreated = true;
    const seedProcess = Bun.spawn(
      ["bunx", "wrangler", "d1", "execute", "system-payroll", target, "--file", tempFile],
      { stdout: "inherit", stderr: "inherit" },
    );
    const exitCode = await seedProcess.exited;
    if (exitCode !== 0) {
      throw new Error(`Wrangler D1 seed failed with exit code ${exitCode}`);
    }

    const keysFile = `./seeded-keys-${crypto.randomUUID()}.txt`;
    await writeFile(keysFile, `${seededKeys.join("\n")}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      `Added ${seededKeys.length} new keys. Database now contains ${existingSelectors.size + seededKeys.length} keys. Store newly generated keys securely: ${keysFile}`,
    );
  } finally {
    if (tempFileCreated) {
      await unlink(tempFile).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}

await main();
