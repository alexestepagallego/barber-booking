import { eq } from "drizzle-orm";

import { appointments } from "@/server/db/schema";
import { runWithDb } from "@/server/scripts";

import { deriveManageToken, hashToken } from "./tokens";

/**
 * npm run tokens:rehash
 *
 * Recomputes every appointment's manage-link hash from the CURRENT
 * MANAGE_LINK_SECRET. Run it right after rotating the secret (see
 * docs/security.md): links in emails sent before the rotation stop
 * working, and every email sent afterwards carries a working new link.
 */
void runWithDb(async (db) => {
  const rows = await db.select({ id: appointments.id }).from(appointments);
  await db.transaction(async (tx) => {
    for (const { id } of rows) {
      await tx
        .update(appointments)
        .set({ manageTokenHash: hashToken(deriveManageToken(id)) })
        .where(eq(appointments.id, id));
    }
  });
  return { rehashed: rows.length };
});
