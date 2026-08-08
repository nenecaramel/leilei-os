import { useEffect, useState } from "react";
import {
  ArchiveIcon,
  DashboardIcon,
  PenIcon,
  SearchIcon,
} from "../components/icons.js";

type MemoryPageHeaderProps = {
  count: number;
  categories: Array<{ value: string; label: string }>;
  tags: string[];
  category: string;
  tag: string;
  searchDraft: string;
  busy: boolean;
  onCategoryChange(value: string): void;
  onTagChange(value: string): void;
  onSearchChange(value: string): void;
  onClearFilters(): void;
  onOpenArchive(trigger: HTMLElement): void;
  onCreate(trigger: HTMLElement): void;
};

export function MemoryPageHeader({
  count,
  categories,
  tags,
  category,
  tag,
  searchDraft,
  busy,
  onCategoryChange,
  onTagChange,
  onSearchChange,
  onClearFilters,
  onOpenArchive,
  onCreate,
}: MemoryPageHeaderProps) {
  const [openMenu, setOpenMenu] = useState<"category" | "tag" | null>(null);
  const [searchOpen, setSearchOpen] = useState(Boolean(searchDraft));

  useEffect(() => {
    if (searchDraft) setSearchOpen(true);
  }, [searchDraft]);

  return (
    <header
      className="memory-page-header"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        setOpenMenu(null);
        setSearchOpen(false);
      }}
    >
      <div className="memory-page-heading">
        <div className="memory-page-title">Memory</div>
        <div className="memory-page-count">{count}条记忆</div>
      </div>

      <div className="memory-page-tools">
        <div className="memory-page-tool-wrap">
          <button
            type="button"
            aria-label="筛选分类"
            aria-expanded={openMenu === "category"}
            disabled={busy}
            onClick={() => setOpenMenu((value) => value === "category" ? null : "category")}
          >
            <DashboardIcon />
          </button>
          {openMenu === "category" ? (
            <div className="memory-page-popover" role="menu" aria-label="Memory 分类">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={category === ""}
                onClick={() => {
                  onCategoryChange("");
                  setOpenMenu(null);
                }}
              >
                全部分类
              </button>
              {categories.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={category === item.value}
                  onClick={() => {
                    onCategoryChange(item.value);
                    setOpenMenu(null);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="memory-page-tool-wrap">
          <button
            type="button"
            aria-label="筛选标签"
            aria-expanded={openMenu === "tag"}
            disabled={busy}
            onClick={() => setOpenMenu((value) => value === "tag" ? null : "tag")}
          >
            <span aria-hidden="true">#</span>
          </button>
          {openMenu === "tag" ? (
            <div className="memory-page-popover" role="menu" aria-label="Memory 标签">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={tag === ""}
                onClick={() => {
                  onTagChange("");
                  setOpenMenu(null);
                }}
              >
                全部标签
              </button>
              {tags.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="menuitemradio"
                  aria-checked={tag === item}
                  onClick={() => {
                    onTagChange(item);
                    setOpenMenu(null);
                  }}
                >
                  #{item}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          aria-label="搜索记忆"
          aria-expanded={searchOpen}
          disabled={busy}
          onClick={() => {
            setOpenMenu(null);
            setSearchOpen((value) => !value);
          }}
        >
          <SearchIcon className="memory-page-search-icon" />
        </button>
        <button
          type="button"
          aria-label="查看归档"
          disabled={busy}
          onClick={(event) => onOpenArchive(event.currentTarget)}
        >
          <ArchiveIcon />
        </button>
        <button
          type="button"
          aria-label="新增记忆"
          disabled={busy}
          onClick={(event) => onCreate(event.currentTarget)}
        >
          <PenIcon className="memory-page-create-icon" />
        </button>
      </div>

      {searchOpen ? (
        <div className="memory-page-search">
          <SearchIcon />
          <input
            type="search"
            aria-label="搜索记忆"
            maxLength={200}
            placeholder="搜索 Key 或内容"
            value={searchDraft}
            onChange={(event) => onSearchChange(event.target.value)}
          />
          {searchDraft || category || tag ? (
            <button type="button" aria-label="清除筛选" onClick={onClearFilters}>
              ×
            </button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
