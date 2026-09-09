import { useEffect, useState } from "react";
import { ArchiveIcon, CalendarIcon, PenIcon, StatusIcon } from "../components/icons";
import { NativeDateInput } from "../components/NativeDateInput";
import { ModuleSearchButton, ModuleSearchField } from "../components/ModuleSearch";
import type { TaskDueFilter } from "./task-location";

type Props = {
  count: number; due: TaskDueFilter; dueFrom: string; dueTo: string; status: string; tagDraft: string; searchDraft: string; busy: boolean;
  onDueChange(value: Exclude<TaskDueFilter, "custom">): void;
  onDueRangeChange(from: string, to: string): void;
  onStatusChange(value: string): void; onTagChange(value: string): void; onSearchChange(value: string): void;
  onOpenArchive(trigger: HTMLElement): void; onCreate(trigger: HTMLElement): void;
};
type OpenTool = "time" | "status" | "tag" | null;
const TIMES: ReadonlyArray<{ value: Exclude<TaskDueFilter, "custom">; label: string }> = [
  { value: "", label: "全部时间" }, { value: "overdue", label: "已逾期" }, { value: "today", label: "今天" },
  { value: "next_7_days", label: "未来七天" }, { value: "later", label: "更晚" }, { value: "no_due_date", label: "无截止时间" },
];
const STATUSES = [
  ["", "全部状态"], ["pending", "待处理"], ["in_progress", "进行中"], ["completed", "已完成"], ["cancelled", "已取消"],
] as const;
export function TaskPageHeader(props: Props) {
  const [tool, setTool] = useState<OpenTool>(null);
  const [searchOpen, setSearchOpen] = useState(Boolean(props.searchDraft));
  const [customOpen, setCustomOpen] = useState(props.due === "custom");
  useEffect(() => { if (props.searchDraft) setSearchOpen(true); }, [props.searchDraft]);
  useEffect(() => { if (props.due === "custom") setCustomOpen(true); }, [props.due]);
  const toggle = (next: Exclude<OpenTool, null>) => { setSearchOpen(false); setTool((v) => v === next ? null : next); };
  return (
    <header className="memory-page-header task-page-header" onKeyDown={(e) => { if (e.key === "Escape") { setTool(null); setSearchOpen(false); } }}>
      <div className="memory-page-heading"><div className="memory-page-title">Task</div><div className="memory-page-count">{props.count}项任务</div></div>
      <div className="memory-page-tools task-page-tools">
        <div className="memory-page-tool-wrap task-time-tool-wrap">
          <button type="button" aria-label="按截止时间筛选" aria-expanded={tool === "time"} aria-pressed={Boolean(props.due)} disabled={props.busy} onClick={() => toggle("time")}><CalendarIcon className="diary-page-date-icon" /></button>
          {tool === "time" ? <div className="memory-page-popover task-filter-popover task-time-popover" aria-label="Task 截止时间筛选">
            {TIMES.map((o) => <button key={o.value || "all"} type="button" role="menuitemradio" aria-checked={props.due === o.value} onClick={() => { setCustomOpen(false); props.onDueChange(o.value); }}>{o.label}</button>)}
            <button type="button" role="menuitemradio" aria-checked={props.due === "custom"} onClick={() => setCustomOpen(true)}>自定义范围</button>
            {customOpen ? <div className="task-custom-range">
              <NativeDateInput type="datetime-local" aria-label="Task 自定义开始时间" value={props.dueFrom} max={props.dueTo || undefined} onChange={(e) => props.onDueRangeChange(e.target.value, props.dueTo)} />
              <NativeDateInput type="datetime-local" aria-label="Task 自定义结束时间" value={props.dueTo} min={props.dueFrom || undefined} onChange={(e) => props.onDueRangeChange(props.dueFrom, e.target.value)} />
            </div> : null}
          </div> : null}
        </div>
        <div className="memory-page-tool-wrap">
          <button type="button" aria-label="按状态筛选" aria-expanded={tool === "status"} aria-pressed={Boolean(props.status)} disabled={props.busy} onClick={() => toggle("status")}><StatusIcon className="task-page-status-icon" /></button>
          {tool === "status" ? <div className="memory-page-popover task-filter-popover" aria-label="Task 状态筛选">{STATUSES.map(([value, label]) => <button key={value || "all"} type="button" role="menuitemradio" aria-checked={props.status === value} onClick={() => props.onStatusChange(value)}>{label}</button>)}</div> : null}
        </div>
        <div className="memory-page-tool-wrap">
          <button type="button" aria-label="按标签筛选" aria-expanded={tool === "tag"} aria-pressed={Boolean(props.tagDraft)} disabled={props.busy} onClick={() => toggle("tag")}><span className="memory-page-tag-icon" aria-hidden="true">#</span></button>
          {tool === "tag" ? <div className="memory-page-popover diary-filter-popover diary-text-popover"><input type="text" aria-label="按标签筛选" placeholder="标签" maxLength={50} value={props.tagDraft} onChange={(e) => props.onTagChange(e.target.value)} /></div> : null}
        </div>
        <ModuleSearchButton label="搜索任务" expanded={searchOpen} disabled={props.busy} onClick={() => { setTool(null); setSearchOpen((v) => !v); }} />
        <button type="button" aria-label="查看归档" disabled={props.busy} onClick={(e) => props.onOpenArchive(e.currentTarget)}><ArchiveIcon /></button>
        <button type="button" aria-label="新增任务" disabled={props.busy} onClick={(e) => props.onCreate(e.currentTarget)}><PenIcon className="memory-page-create-icon" /></button>
      </div>
      {searchOpen ? <ModuleSearchField className="task-page-search" ariaLabel="搜索任务内容" placeholder="搜索标题或正文" value={props.searchDraft} onChange={props.onSearchChange} /> : null}
    </header>
  );
}
