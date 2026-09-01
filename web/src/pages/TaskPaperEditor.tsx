import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { NativeDateInput } from "../components/NativeDateInput";
import { TASK_STATUS_LABELS, type TaskMobileStatus } from "./task-mobile-presentation";
import { resizePaperTextarea } from "./paper-editor-autosize";
export type TaskPaperAction = "start" | "complete" | "cancel" | "reopen";
const ACTION_LABELS: Record<TaskPaperAction, string> = { start: "开始", complete: "完成", cancel: "取消", reopen: "重新打开" };
export type TaskPaperEditorHandle = { focusTitle(): void };
export const TaskPaperEditor = forwardRef<TaskPaperEditorHandle, { title: string; description: string; disabled: boolean; onTitleChange(v: string): void; onDescriptionChange(v: string): void }>(function TaskPaperEditor(props, ref) {
  const titleRef = useRef<HTMLInputElement | null>(null); const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(ref, () => ({ focusTitle: () => titleRef.current?.focus() }), []);
  useLayoutEffect(() => { if (bodyRef.current) resizePaperTextarea(bodyRef.current); }, [props.description]);
  return <div className="memory-paper-editor task-paper-editor">
    <input ref={titleRef} className="memory-paper-key task-paper-title-editor" type="text" aria-label="任务标题" placeholder="Title" autoComplete="off" spellCheck={false} value={props.title} disabled={props.disabled} maxLength={200} onChange={(e) => props.onTitleChange(e.target.value)} />
    <textarea ref={bodyRef} className="memory-paper-content-editor task-paper-description-editor" aria-label="任务正文" placeholder="Description" value={props.description} disabled={props.disabled} maxLength={5000} rows={8} onChange={(e) => props.onDescriptionChange(e.target.value)} />
  </div>;
});
export function TaskDeadlineEditor(props: { value: string; withoutDueTime: boolean; disabled: boolean; onValueChange(v: string): void; onWithoutDueTimeChange(v: boolean): void }) {
  const [open, setOpen] = useState(false);
  const display = props.withoutDueTime ? "无截止时间" : props.value ? `${props.value.slice(0,10).replaceAll("-",".")} ${props.value.slice(11,16)}截止` : "设置截止时间";
  return <span className="task-paper-deadline-editor">
    <button type="button" className="task-paper-deadline-trigger" aria-label="编辑任务截止时间" aria-expanded={open} disabled={props.disabled} onClick={() => setOpen((v) => !v)}>{display}</button>
    {open ? <span className="task-paper-deadline-popover">
      <label className="task-paper-no-deadline"><input type="checkbox" checked={props.withoutDueTime} disabled={props.disabled} onChange={(e) => props.onWithoutDueTimeChange(e.target.checked)} /><span>无截止时间</span></label>
      <NativeDateInput type="datetime-local" aria-label="任务截止时间" value={props.value} disabled={props.disabled || props.withoutDueTime} onChange={(e) => { props.onWithoutDueTimeChange(false); props.onValueChange(e.target.value); }} />
    </span> : null}
  </span>;
}
function StatusControl(props: { status: TaskMobileStatus; actions: readonly TaskPaperAction[]; disabled: boolean; onAction?: (a: TaskPaperAction) => void }) {
  const [open, setOpen] = useState(false); const actionable = props.actions.length > 0 && Boolean(props.onAction);
  return <span className="memory-paper-category-wrap task-paper-status-wrap">
    <button type="button" className="memory-paper-category task-paper-status" aria-label="任务状态" aria-haspopup={actionable ? "menu" : undefined} aria-expanded={actionable ? open : undefined} disabled={props.disabled || !actionable} onClick={() => { if (actionable) setOpen((v) => !v); }}>{TASK_STATUS_LABELS[props.status]}</button>
    {open && actionable ? <span className="memory-paper-category-menu task-paper-status-menu" role="menu" aria-label="Task 状态操作">{props.actions.map((a) => <button key={a} type="button" role="menuitem" onClick={() => { setOpen(false); props.onAction?.(a); }}>{ACTION_LABELS[a]}</button>)}</span> : null}
  </span>;
}
export function TaskPaperMetadataRead(props: { status: TaskMobileStatus; tags: readonly string[]; actions: readonly TaskPaperAction[]; disabled: boolean; onAction?: (a: TaskPaperAction) => void }) {
  return <span className="memory-paper-metadata task-paper-metadata"><StatusControl status={props.status} actions={props.actions} disabled={props.disabled} onAction={props.onAction} />{props.tags.length ? <><span className="memory-paper-metadata-separator">·</span><span className="task-paper-tags-read">{props.tags.map((t) => `#${t}`).join(" ")}</span></> : null}</span>;
}
export function TaskPaperMetadataEditor(props: { status: TaskMobileStatus; tagsValue: string; disabled: boolean; onTagsChange(v: string): void }) {
  return <span className="memory-paper-metadata task-paper-metadata"><StatusControl status={props.status} actions={[]} disabled /><span className="memory-paper-metadata-separator">·</span><input className="memory-paper-tags task-paper-tags" type="text" aria-label="任务标签" placeholder="tags" autoComplete="off" value={props.tagsValue} disabled={props.disabled} onChange={(e) => props.onTagsChange(e.target.value)} /></span>;
}
