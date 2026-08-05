export type HomeAuthor = "L" | "G";
export type HomeNoteKind = "pending" | "completed" | "record";

export type HomeNote = {
  id: string;
  author: HomeAuthor;
  kind: HomeNoteKind;
  text: string;
};

export type HomeSticky = {
  id: string;
  author: HomeAuthor;
  text: string;
};

export type HomeCalendarDay = {
  day: number;
  hasContent: boolean;
};

export const L_HOME_NOTES: HomeNote[] = [
  { id: "l-1", author: "L", kind: "pending", text: "整理今天的事情" },
  { id: "l-2", author: "L", kind: "completed", text: "项目视觉方向已经确认" },
  { id: "l-3", author: "L", kind: "record", text: "记录一个不强制完成的小念头" },
];

export const G_HOME_NOTES: HomeNote[] = [
  { id: "g-1", author: "G", kind: "pending", text: "项目下一步：保留安静的节奏" },
  { id: "g-2", author: "G", kind: "record", text: "今天 G 留给明天 G 的交接" },
  { id: "g-3", author: "G", kind: "record", text: "准备提醒蕾蕾的一句话" },
  { id: "g-4", author: "G", kind: "completed", text: "一条轻松随机的小念头" },
];

export const HOME_STICKIES: HomeSticky[] = [
  { id: "sticky-1", author: "L", text: "先把今天过完，再决定下一步。" },
  { id: "sticky-2", author: "G", text: "留一点空间给不急着完成的事。" },
];

export const HOME_CALENDAR_DAYS: HomeCalendarDay[] = Array.from({ length: 31 }, (_, index) => ({
  day: index + 1,
  hasContent: [2, 5, 8, 14, 18, 23, 27].includes(index + 1),
}));
