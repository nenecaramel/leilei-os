export type ModuleMonthGroup = {
  key: string;
  label: string;
  rows: {
    id: string;
    title: string;
    date: string;
    meta?: string;
    attributes?: Record<string, string>;
  }[];
};
export function ModuleMonthRows({
  groups,
  busy,
  label,
  onOpen,
}: {
  groups: ModuleMonthGroup[];
  busy: boolean;
  label: string;
  onOpen(id: string, trigger: HTMLElement): void;
}) {
  return (
    <section className="memory-months" aria-label={label}>
      {groups.map((group) => (
        <section className="memory-month-section" key={group.key}>
          {group.label ? (
            <h2 className="memory-month-label">{group.label}</h2>
          ) : null}
          <div className="memory-month-card">
            {group.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className="memory-row"
                {...row.attributes}
                disabled={busy}
                onClick={(event) => onOpen(row.id, event.currentTarget)}
              >
                <span className="memory-row-title">{row.title}</span>
                <span className="memory-row-meta">
                  <span>{row.date}</span>
                  <span>{row.meta ?? ""}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
export function ModuleMonthLoading({
  label,
  loadingText,
}: {
  label: string;
  loadingText: string;
}) {
  return (
    <section className="memory-months" aria-label={label} aria-busy="true">
      <span className="visually-hidden" role="status" aria-live="polite">
        {loadingText}
      </span>
      {[0, 1].map((index) => (
        <div className="memory-month-skeleton" aria-hidden="true" key={index}>
          <span className="memory-month-skeleton-label" />
          <div className="memory-month-skeleton-card">
            <span />
            <span />
          </div>
        </div>
      ))}
    </section>
  );
}
