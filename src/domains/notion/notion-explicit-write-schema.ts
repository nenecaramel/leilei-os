import { z } from "zod";

const MAX_JSON_BODY_LENGTH = 250_000;

const boundedJson = <T extends z.ZodTypeAny>(schema: T) => schema.refine((value) => {
  try {
    return JSON.stringify(value).length <= MAX_JSON_BODY_LENGTH;
  } catch {
    return false;
  }
}, "Notion explicit page payload is too large.");

export const notionExplicitWriteIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (value) => !value.includes("://") && !value.includes("/") && !value.includes("\\"),
    "Notion resource IDs must not be URLs or paths.",
  );

export const notionPageParentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("page_id"),
    page_id: notionExplicitWriteIdSchema,
  }).strict(),
  z.object({
    type: z.literal("database_id"),
    database_id: notionExplicitWriteIdSchema,
  }).strict(),
  z.object({
    type: z.literal("data_source_id"),
    data_source_id: notionExplicitWriteIdSchema,
  }).strict(),
  z.object({
    type: z.literal("workspace"),
    workspace: z.literal(true),
  }).strict(),
]);

const notionPagePropertiesSchema = boundedJson(
  z.record(z.string().max(200), z.unknown()),
);

export const notionPageCreateBodySchema = boundedJson(z.object({
  parent: notionPageParentSchema.optional(),
  properties: notionPagePropertiesSchema,
}).strict());

export const notionPageCreateMutationBodySchema = notionPageCreateBodySchema.refine(
  (value) => value.parent !== undefined,
  "Notion page create requires an explicit parent.",
);

export const notionPageUpdateBodySchema = boundedJson(z.object({
  properties: notionPagePropertiesSchema,
}).strict());

const markdownContentSchema = z
  .string()
  .max(MAX_JSON_BODY_LENGTH)
  .refine((value) => value.trim().length > 0, "Notion page content must not be empty.");

export const notionPageContentUpdateBodySchema = boundedJson(z.discriminatedUnion("type", [
  z.object({
    type: z.literal("replace_content"),
    replace_content: z.object({ new_str: markdownContentSchema }).strict(),
  }).strict(),
  z.object({
    type: z.literal("insert_content"),
    insert_content: z.object({ content: markdownContentSchema }).strict(),
  }).strict(),
]));
