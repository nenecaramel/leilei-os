type MemoryPageHeaderProps = {
  count: number;
  busy: boolean;
  onOpenArchive(): void;
  onCreate(): void;
};

export function MemoryPageHeader({
  count,
  busy,
  onOpenArchive,
  onCreate,
}: MemoryPageHeaderProps) {
  return (
    <header className="memory-page-header">
      <div className="memory-page-heading">
        <div className="memory-page-title">Memory</div>
        <div className="memory-page-count">{count}条记忆</div>
      </div>

      <div className="memory-page-tools">
        <button type="button" aria-label="筛选分类" disabled={busy}>
          <span aria-hidden="true">▦</span>
        </button>
        <button type="button" aria-label="筛选标签" disabled={busy}>
          <span aria-hidden="true">#</span>
        </button>
        <button type="button" aria-label="搜索记忆" disabled={busy}>
          <span aria-hidden="true">⌕</span>
        </button>
        <button type="button" aria-label="查看归档" disabled={busy} onClick={onOpenArchive}>
          <span aria-hidden="true">▣</span>
        </button>
        <button type="button" aria-label="新增记忆" disabled={busy} onClick={onCreate}>
          <span aria-hidden="true">✎</span>
        </button>
      </div>
    </header>
  );
}
