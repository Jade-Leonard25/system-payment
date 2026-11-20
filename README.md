# server

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run
```

To type check:

```bash
bun check
```

To apply pending local D1 migrations and seed 1,000 product keys:

```bash
bun run seed
```

The command defaults to the local database. Use `bun run seed --remote` only when you intend to seed the configured remote D1 database. Generated keys are saved to a git-ignored `seeded-keys-*.txt` file. Key values are also stored in D1 so the admin dashboard can display them; this is less secure than storing hashes alone, so protect database access and keep the export private. To import the original seed export into the existing remote records, run `bun run seed --import-existing ./seeded-keys-<id>.txt --remote`.

Key verification is available at `POST /api/key-products/verify` with JSON body `{"key":"abc-def-123"}`. Administrators can create keys with `POST /api/key-products`, list up to 1,000 key records with `GET /api/key-products?limit=1000`, and revoke a key with `DELETE /api/key-products/:id`. The backend serves a testing dashboard at `/` showing full keys to signed-in administrators.

Run `bun fmt` to format the code.

This project was created using `bun init` in bun v1.4.4. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
# system-payment
