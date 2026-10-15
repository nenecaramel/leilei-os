import { randomUUID } from 'node:crypto';

const TERMINAL = new Set(['completed', 'failed', 'stopped']);
const HISTORY_LIMIT = 128;
const LIVE_LIMIT = 1024;
const STOP_TIMEOUT_MS = 2_000;

/** Process-local task ownership. SDK level snapshots alone own live membership. */
export class AgentSdkTaskState {
  constructor(onChange = () => {}) {
    this.live = new Map();
    this.records = new Map();
    this.onChange = onChange;
    this.closed = false;
  }

  list() {
    return [...this.records.values()].map(({ stopPromise, observedOnly, ...record }) => ({ ...record }));
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
      for (const [id, record] of this.live) {
        const task = next.get(id);
        if (!task || (task.run_id ?? null) !== record.runId) {
          record.active = false;
          if (!TERMINAL.has(record.status)) record.status = 'ended';
          this.live.delete(id);
        }
      }
      for (const [id, task] of next) {
        let record = this.live.get(id);
        if (!record) {
          record = task.run_id ? [...this.records.values()].reverse().find(item => item.observedOnly && item.taskId === id && item.runId === task.run_id) : null;
          record ??= this.createRecord(id, task.run_id ?? null);
          record.observedOnly = false; record.active = true;
          if (record.status === 'observed') record.status = 'running';
          this.live.set(id, record);
        }
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
      // task_updated patches are observability, never membership authority.
    }
    this.prune(); this.changed();
  }

  createRecord(taskId, runId) {
    const record = { taskId, runId, handle: randomUUID(), active: false, observedOnly: true,
      status: 'observed', taskType: null, description: null, parentTaskId: null, ambient: false, summary: null };
    this.records.set(record.handle, record);
    return record;
  }

  stop(id, expected, send) {
    if (this.closed) return Promise.reject(new Error('Session task owner is closed.'));
    const record = this.live.get(id);
    if (!record) return Promise.reject(new Error('Unknown session task.'));
    if (expected !== undefined && (!expected || Object.keys(expected).some(key => key !== 'handle') || expected.handle !== record.handle)) return Promise.reject(new Error('Stale task handle.'));
    if (record.stopPromise) return record.stopPromise;
    if (TERMINAL.has(record.status)) return Promise.reject(new Error('Session task has already ended.'));
    record.status = 'stop_requested';
    // Install the shared promise before invoking the SDK: even a reentrant
    // consumer cannot issue a second uncertain control for this task run.
    let resolve, reject;
    record.stopPromise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => {
      if (this.live.get(id) === record && !this.closed && !TERMINAL.has(record.status)) { record.status = 'stop_unknown'; this.changed(); }
      reject(new Error('Task stop acknowledgement timed out; outcome unknown.'));
    }, STOP_TIMEOUT_MS);
    const settle = (error) => {
      clearTimeout(timer);
      if (this.closed || this.live.get(id) !== record) { reject(new Error('Stale task stop acknowledgement.')); return; }
      if (error) {
        if (!TERMINAL.has(record.status)) record.status = 'stop_unknown';
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
      if ((record.active || record.observedOnly) && !TERMINAL.has(record.status)) record.status = 'unknown';
      record.active = false;
    }
    this.live.clear(); this.prune(); this.changed();
  }

  prune() {
    const history = [...this.records.values()].filter(item => !item.active);
    for (const record of history.slice(0, Math.max(0, history.length - HISTORY_LIMIT))) this.records.delete(record.handle);
  }
  changed() { this.onChange(this.list()); }
}
function identity(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 512; }
function text(value, max) { return typeof value === 'string' ? value.slice(0, max) : null; }
