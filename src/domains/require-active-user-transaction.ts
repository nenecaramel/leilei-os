import { eq } from "drizzle-orm";
import type { createDatabase } from "../database/client.js";
import { users } from "../database/schema.js";
import { requireActiveUser } from "./require-active-user.js";

type Database = ReturnType<typeof createDatabase>["db"];
export type ActiveUserMutationTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export async function requireActiveUserInTransaction(
  transaction: ActiveUserMutationTransaction,
  userId: string,
): Promise<string> {
  return requireActiveUser(
    {
      findUserById: async (candidate) => {
        const [user] = await transaction
          .select({ status: users.status })
          .from(users)
          .where(eq(users.id, candidate))
          .for("share")
          .limit(1);
        return user ?? null;
      },
    },
    userId,
  );
}
