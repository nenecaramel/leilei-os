type PlaceholderPageProps = {
  title: string;
};

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div className="page memory-page simple-placeholder-page">
      <header className="memory-page-header">
        <div className="memory-page-heading">
          <div className="memory-page-title">{title}</div>
        </div>
      </header>
    </div>
  );
}
