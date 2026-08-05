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
  { id: "g-1", author: "G", kind: "pending", text: "项目下一步：确定侧边栏交互" },
  { id: "g-2", author: "G", kind: "record", text: "明天记得向蕾蕾推进进度展开方式" },
  { id: "g-3", author: "G", kind: "record", text: "准备提醒蕾蕾吃午饭啦" },
];

export const HOME_STICKIES: HomeSticky[] = [
  { id: "sticky-1", author: "L", text: "灵感：\n未来的日记可以\n跟天气联动~" },
  { id: "sticky-2", author: "G", text: "想去看一场\n海边的日落 ▪" },
];

export const HOME_CALENDAR_DAYS: HomeCalendarDay[] = Array.from({ length: 31 }, (_, index) => ({
  day: index + 1,
  hasContent: [2, 5, 8, 14, 18, 23, 27].includes(index + 1),
}));
