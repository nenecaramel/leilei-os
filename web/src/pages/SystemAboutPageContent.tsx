import type {
  SystemBuildInfo,
} from "../system/build-metadata";
import { PageHeader } from "./PageHeader";

function BuildRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="system-detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function SystemAboutPageContent({
  buildInfo,
}: {
  buildInfo: SystemBuildInfo;
}) {
  return (
    <div
      className={
        "page system-page system-about-page"
      }
    >
      <PageHeader
        eyebrow="Settings"
        title="About"
        description="Build information for this Leilei OS client."
      />

      <section
        className="system-section"
        aria-label="Leilei OS build information"
      >
        <h2 className="system-product-name">
          Leilei OS
        </h2>

        <dl className="system-detail-list">
          <BuildRow
            label="Version"
            value={buildInfo.version}
          />
          <BuildRow
            label="Commit"
            value={buildInfo.commit}
          />
          <BuildRow
            label="Environment"
            value={buildInfo.environment}
          />
        </dl>
      </section>
    </div>
  );
}
