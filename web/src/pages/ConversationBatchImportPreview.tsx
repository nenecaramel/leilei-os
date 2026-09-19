import type { ConversationImportBatchPreview } from "./conversation-archive-api";
import { conversationProviderLabel, formatConversationBytes } from "./conversation-presentation";

function statusLabel(status: ConversationImportBatchPreview["items"][number]["status"]): string {
  if (status === "pending") return "待执行";
  if (status === "already_executed") return "已导入";
  return "批内重复";
}

export function ConversationBatchImportPreview({
  preview,
  importing,
  onCancel,
  onExecute,
}: {
  preview: ConversationImportBatchPreview;
  importing: boolean;
  onCancel: () => void;
  onExecute: () => void;
}) {
  return (
    <section className="conversation-import-preview conversation-batch-preview" aria-live="polite">
      <div className="conversation-batch-preview-main">
        <p className="eyebrow">Batch Import Preview</p>
        <h2>{preview.files.total} 份 Conversation export</h2>
        <p>
          {preview.files.pending} 份待执行 ·
          {" "}{preview.files.already_executed} 份已导入 ·
          {" "}{preview.files.duplicate} 份批内重复
        </p>
        <p>
          汇总：{preview.summary.conversations.create} 新窗口 ·
          {" "}{preview.summary.conversations.update} 更新 ·
          {" "}{preview.summary.messages.create} 新消息
        </p>
        <p className="conversation-import-note">
          整批会按当前顺序累计 Preview，并在一次 SERIALIZABLE Execute 中重新验证整个 batch fingerprint；
          任一文件在执行前变旧都会阻止整批写入。
        </p>
        {(preview.exclusions.conversations > 0 || preview.exclusions.messages > 0) ? (
          <p className="conversation-import-note">
            已按删除规则跳过 {preview.exclusions.conversations} 个窗口、
            {" "}{preview.exclusions.messages} 个消息节点。
          </p>
        ) : null}
        {preview.warning_count > 0 ? (
          <p className="conversation-import-note">
            {preview.warning_count} 个保留型解析提示；未知 block 仍会保存。
          </p>
        ) : null}

        <div className="conversation-batch-file-list">
          {preview.items.map((item) => (
            <div className="conversation-batch-file" key={`${item.input_index}:${item.import_run_id}`}>
              <div>
                <strong>{item.input_index + 1}. {item.filename}</strong>
                <span>
                  {conversationProviderLabel(item.provider)} · {formatConversationBytes(item.raw_bytes)}
                </span>
              </div>
              <div className="conversation-batch-file-result">
                <span className={`conversation-batch-status conversation-batch-status--${item.status}`}>
                  {statusLabel(item.status)}
                </span>
                {item.status === "pending" ? (
                  <small>
                    {item.summary.conversations.create} 新窗口 ·
                    {" "}{item.summary.conversations.update} 更新 ·
                    {" "}{item.summary.messages.create} 新消息
                  </small>
                ) : item.status === "duplicate_in_batch" ? (
                  <small>不会重复计入本次整批写入。</small>
                ) : (
                  <small>canonical 已有对应执行，不会重复写入。</small>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="conversation-import-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={importing}
          onClick={onCancel}
        >
          取消
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={importing || preview.files.pending === 0}
          onClick={onExecute}
        >
          {importing
            ? "执行中…"
            : preview.files.pending === 0
              ? "无需导入"
              : "确认整批导入"}
        </button>
      </div>
    </section>
  );
}
