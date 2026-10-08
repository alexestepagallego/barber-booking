import { config } from "dotenv";

import { createDb } from "@/server/db/client";

import { createAdminUser } from "./auth";

/**
 * Creates (or updates the password of) an admin user:
 *
 *   ADMIN_PASSWORD='a long passphrase' npm run admin:create -- owner@example.com "Owner Name"
 *
 * The password comes from an environment variable, not an argument, so it
 * does not end up in the shell history or the process list. Changing a
 * password signs out that admin's existing sessions.
 */
async function main() {
  config({ path: [".env.local", ".env"], quiet: true });
  const [email, ...nameParts] = process.argv.slice(2);
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error(
      "Usage: ADMIN_PASSWORD='…' npm run admin:create -- <email> [name]\n" +
        "The password must have at least 12 characters.",
    );
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, client } = createDb(url, { max: 1 });
  try {
    const user = await createAdminUser(db, {
      email,
      name: nameParts.join(" ") || email.split("@")[0]!,
      password,
    });
    console.log(`Admin ready: ${user.email}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
