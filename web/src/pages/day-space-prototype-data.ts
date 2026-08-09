import type { HomeAuthor, HomeNote } from "./home-prototype-data.js";

export type DaySpaceDiaryPrototype = {
  id: string;
  date: string;
  author: HomeAuthor;
  title: string;
  content: string;
};

export const DAY_SPACE_TODO_SEEDS: Record<
  string,
  Record<HomeAuthor, HomeNote[]>
> = {
  "2026-08-05": {
    L: [
      { id: "day-l-1", author: "L", kind: "pending", text: "整理 Day Space 页面结构" },
      { id: "day-l-2", author: "L", kind: "completed", text: "确认 Todo 与 Task 不合并" },
      { id: "day-l-3", author: "L", kind: "record", text: "晚上把今天的想法记下来" },
    ],
    G: [
      { id: "day-g-1", author: "G", kind: "completed", text: "检查 System 最终回归" },
      { id: "day-g-2", author: "G", kind: "pending", text: "整理下一阶段 Codex 任务边界" },
    ],
  },
  "2026-08-07": {
    L: [
      { id: "day-l-4", author: "L", kind: "pending", text: "看一遍新的页面比例" },
    ],
    G: [],
  },
};

export const DAY_SPACE_DIARY_PROTOTYPES: DaySpaceDiaryPrototype[] = [
  {
    id: "diary-aug-05-l",
    date: "2026-08-05",
    author: "L",
    title: "今天终于开始像一个真正的空间了",
    content:
      "不是把 Todo、Diary 一格一格塞进页面，而是让它们像当天留下来的纸一样待在这里。打开某一天，看见的就是那一天。",
  },
  {
    id: "diary-aug-05-g",
    date: "2026-08-05",
    author: "G",
    title: "Day Space",
    content:
      "先把“这一天”本身做清楚。数据、Calendar marker 和 MCP 都等页面语义稳定以后再接。",
  },
  {
    id: "diary-aug-07-l",
    date: "2026-08-07",
    author: "L",
    title: "留一点空白",
    content:
      "页面不需要把所有东西解释完。纸张之间有距离，日期只是入口，内容自己说话。",
  },
];

export function getDaySpacePrototypeDates(): string[] {
  return [
    ...new Set([
      ...Object.keys(DAY_SPACE_TODO_SEEDS),
      ...DAY_SPACE_DIARY_PROTOTYPES.map((entry) => entry.date),
    ]),
  ].sort();
}
