import { ModulePageHeader } from "./ModulePageHeader";

type DiaryPageHeaderProps = {
  count: number;
  dateFrom: string;
  dateTo: string;
  moodDraft: string;
  tagDraft: string;
  searchDraft: string;
  filterError: string;
  busy: boolean;
  onDateFromChange(value: string): void;
  onDateToChange(value: string): void;
  onDateRangeClear(): void;
  onMoodChange(value: string): void;
  onTagChange(value: string): void;
  onSearchChange(value: string): void;
  onOpenArchive(trigger: HTMLElement): void;
  onCreate(trigger: HTMLElement): void;
};

export function DiaryPageHeader({ count, ...props }: DiaryPageHeaderProps) {
  return (
    <ModulePageHeader
      {...props}
      title="Diary"
      countLabel={`${count}篇日记`}
      searchLabel="搜索日记"
      searchPlaceholder="Search diary entries..."
      createLabel="新增日记"
      diaryTools
    />
  );
}
