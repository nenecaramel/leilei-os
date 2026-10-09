import { ModuleStateMessage } from "../components/ModuleSearch";
import { ModuleMonthLoading } from "./ModuleMonthRows";

export function ModuleListLoading({
  searching,
  label,
  loadingText,
}: {
  searching: boolean;
  label: string;
  loadingText: string;
}) {
  return searching ? (
    <ModuleStateMessage
      state="loading"
      placement="module"
      emptyText=""
      errorText=""
      loadingText="Searching..."
    />
  ) : (
    <ModuleMonthLoading label={label} loadingText={loadingText} />
  );
}

export function ModuleListEmpty({
  searching,
  filtered,
  noun,
  onClear,
}: {
  searching: boolean;
  filtered: boolean;
  noun: string;
  onClear(): void;
}) {
  const action = filtered ? (
    <button
      type="button"
      className="secondary-button memory-empty-clear"
      onClick={onClear}
    >
      清除条件
    </button>
  ) : undefined;
  const text = filtered ? `没有符合条件的${noun}` : `还没有${noun}`;
  return searching ? (
    <ModuleStateMessage
      state="empty"
      emptyText={text}
      errorText=""
      action={action}
    />
  ) : (
    <section className="memory-empty-state">
      <p>{text}</p>
      {action}
    </section>
  );
}
