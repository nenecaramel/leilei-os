import { z } from "zod";

const DATE = String.raw`(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|02-(?:0[1-9]|1\d|2[0-8])))`;
const TIME = String.raw`(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?`;
const UTC = new RegExp(`^${DATE}T${TIME}Z$`);
const WITH_OFFSET = new RegExp(`^${DATE}T${TIME}(?:Z|[+-]\\d{2}:?\\d{2})$`);

/**
 * ISO date-time. Unlike Zod 4's own format, seconds stay optional and an offset
 * may omit its colon, so times a model writes and older backups keep parsing.
 */
export const isoDateTime = (options: { offset?: boolean } = {}) =>
  z.string()
    .refine((value) => (options.offset ? WITH_OFFSET : UTC).test(value), { message: "Invalid datetime" })
    .meta({ format: "date-time" });

/**
 * Optional field whose default is advertised but applied by the handler. Zod 4
 * would fill `.default(x).optional()` in, and a call that continues from a
 * cursor could then disagree with the page size the cursor was made for.
 */
export const optionalWithDefault = <T extends z.ZodType>(schema: T, value: z.output<T>) =>
  schema.optional().meta({ default: value });
