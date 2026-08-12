export type TodoAuthor = "L" | "G";
export type TodoEntryKind = "pending" | "completed" | "record";
export type TodoEntry = { id: string; kind: TodoEntryKind; text: string };
export type TodoPaper = { author: TodoAuthor; date: string; revision: number; entries: TodoEntry[] };
export type TodoDay = { date: string; papers: { L: TodoPaper | null; G: TodoPaper | null } };
