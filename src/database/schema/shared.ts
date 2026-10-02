import {
  customType,
  pgEnum,
} from "drizzle-orm/pg-core";


export const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const contentAuthorEnum = pgEnum("content_author", ["L", "G", "C"]);
