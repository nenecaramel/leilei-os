import { randomUUID } from 'node:crypto';

const TERMINAL = new Set(['completed', 'failed', 'stopped', 'killed']);
const SDK_STATUS = new Set(['pending', 'running', 'paused', 'completed', 'failed', 'killed']);
const HISTORY_LIMIT = 128;
const LIVE_LIMIT = 1024;
const STOP_TIMEOUT_MS = 2_000;

/** Process-local task ownership. SDK level snapshots alone own live membership. */
export class AgentSdkTaskState {
  constructor(onChange = () => {}) {
    this.records = new Map();
    this.onChange = onChange;
    this.closed = false;
  }

  list() {
    return [...this.records.values()].map(({ stopPromise, observedOnly, member, ...record }) => ({ ...record, active: member !== null && !this.closed }));
  }
  // A detached compatibility view, not a second owner of live membership.
  members() { return new Map([...this.records.values()].filter(record => record.member !== null).map(record => [record.taskId, record.member])); }
  current(id) { return [...this.records.values()].find(record => record.member !== null && record.taskId === id); }

  capture(id, handle) {
    if (this.closed) throw new Error('Session task owner is closed.');
    const record = this.records.get(handle);
    const latest = [...this.records.values()].reverse().find(item => item.taskId === id && !item.observedOnly);
    if (!record || record.taskId !== id || record.observedOnly || record !== latest) throw new Error('Stale task handle.');
    return record;
  }

  observe(message) {
    if (this.closed || message?.type !== 'system') return;
    if (message.subtype === 'background_tasks_changed') {
      if (!Array.isArray(message.tasks) || message.tasks.length > LIVE_LIMIT) throw new Error('Invalid SDK task snapshot.');
      const next = new Map();
      // Validate the complete replacement before changing any ownership.
      for (const task of message.tasks) {
        if (!identity(task?.task_id) || (task.run_id !== undefined && !identity(task.run_id)) || next.has(task.task_id)) throw new Error('Invalid SDK task identity.');
        next.set(task.task_id, task);
      }
      for (const record of this.records.values()) {
        if (record.member === null) continue;
        const id = record.taskId;
        const task = next.get(id);
        if (!task || (task.run_id ?? null) !== record.runId) {
          record.member = null;
          if (!TERMINAL.has(record.status)) record.status = 'ended';
        }
      }
      for (const [id, task] of next) {
        let record = this.current(id);
        if (!record) {
          record = task.run_id ? [...this.records.values()].reverse().find(item => item.observedOnly && item.taskId === id && item.runId === task.run_id) : null;
          record ??= this.createRecord(id, task.run_id ?? null);
          record.observedOnly = false;
          // Appearance order, not the order an early bookend was received.
          this.records.delete(record.handle); this.records.set(record.handle, record);
          if (record.status === 'observed') record.status = 'running';
        }
        record.member = Object.freeze({ ...task });
        record.taskType = text(task.task_type, 128);
        record.description = text(task.description, 2_000);
        record.parentTaskId = text(task.parent_task_id, 512);
        record.ambient = task.ambient === true;
      }
      this.prune(); this.changed(); return;
    }
    if (!['task_started', 'task_progress', 'task_updated', 'task_notification'].includes(message.subtype)) return;
    // A task_id is reusable, and old CLIs do not identify runs. Missing run_id
    // cannot safely attribute an edge; the level still exposes that task.
    if (!identity(message.task_id) || !identity(message.run_id)) return;
    if (message.subtype === 'task_notification' && !TERMINAL.has(message.status)) return;
    const record = [...this.records.values()].reverse().find(item => item.taskId === message.task_id && item.runId === message.run_id)
      ?? this.createRecord(message.task_id, message.run_id);
    if (message.subtype === 'task_notification') {
      record.status = message.status; record.summary = text(message.summary, 4_000);
    } else if (!TERMINAL.has(record.status)) {
      const patch = message.subtype === 'task_updated' && message.patch && typeof message.patch === 'object' && !Array.isArray(message.patch) ? message.patch : message;
      if (typeof patch.description === 'string') record.description = text(patch.description, 2_000);
      if (typeof message.summary === 'string') record.summary = text(message.summary, 4_000);
      if (message.subtype === 'task_updated' && SDK_STATUS.has(patch.status)) record.status = patch.status;
      // Patches update SDK status, never live membership.
    }
    this.prune(); this.changed();
  }

  createRecord(taskId, runId) {
    const record = { taskId, runId, handle: randomUUID(), member: null, observedOnly: true,
      status: 'observed', stopStatus: null, taskType: null, description: null, parentTaskId: null, ambient: false, summary: null };
    this.records.set(record.handle, record);
    return record;
  }

  stop(id, expected, send) {
    if (this.closed) return Promise.reject(new Error('Session task owner is closed.'));
    const record = this.current(id);
    if (!record) return Promise.reject(new Error('Unknown session task.'));
    if (expected !== undefined && (!expected || Object.keys(expected).some(key => key !== 'handle') || expected.handle !== record.handle)) return Promise.reject(new Error('Stale task handle.'));
    if (record.stopPromise) return record.stopPromise;
    if (TERMINAL.has(record.status)) return Promise.reject(new Error('Session task has already ended.'));
    record.stopStatus = 'requested';
    // Install the shared promise before invoking the SDK: even a reentrant
    // consumer cannot issue a second uncertain control for this task run.
    let resolve, reject;
    record.stopPromise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => {
      if (this.current(id) === record && !this.closed && !TERMINAL.has(record.status)) { record.stopStatus = 'unknown'; this.changed(); }
      reject(new Error('Task stop acknowledgement timed out; outcome unknown.'));
    }, STOP_TIMEOUT_MS);
    const settle = (error) => {
      clearTimeout(timer);
      if (this.closed || this.current(id) !== record) { reject(new Error('Stale task stop acknowledgement.')); return; }
      if (error) {
        if (!TERMINAL.has(record.status)) record.stopStatus = 'unknown';
        this.changed(); reject(new Error('Task stop outcome unknown.', { cause: error }));
      } else resolve();
    };
    try { Promise.resolve(send(id)).then(() => settle(null), error => settle(error)); }
    catch (error) { settle(error); }
    this.changed();
    return record.stopPromise;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const record of this.records.values()) {
      if ((record.member !== null || record.observedOnly) && !TERMINAL.has(record.status)) record.status = 'unknown';
    }
    this.prune(); this.changed();
  }

  prune() {
    const history = [...this.records.values()].filter(item => item.member === null);
    for (const record of history.slice(0, Math.max(0, history.length - HISTORY_LIMIT))) this.records.delete(record.handle);
  }
  changed() { this.onChange(this.list()); }
}
function identity(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 512; }
function text(value, max) { return typeof value === 'string' ? value.slice(0, max) : null; }
