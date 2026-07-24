import type { ReactNode } from "react";
import { PageHeader } from "./PageHeader";

type PlaceholderPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  note: string;
  icon: ReactNode;
};

export function PlaceholderPage({
  description,
  eyebrow,
  icon,
  note,
  title,
}: PlaceholderPageProps) {
  return (
    <div className="page">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <section className="placeholder-panel">
        <div className="placeholder-icon">{icon}</div>
        <span className="status-pill">Foundation ready</span>
        <h2>{title} 页面框架已建立</h2>
        <p>{note}</p>
      </section>
    </div>
  );
}
