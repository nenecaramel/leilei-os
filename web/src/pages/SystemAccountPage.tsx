import { useAuth0 } from "@auth0/auth0-react";
import { PageHeader } from "./PageHeader";

type SystemAccountPageContentProps = {
  name: string;
  email: string;
  onSignOut(): void;
};

export function SystemAccountPageContent({
  name,
  email,
  onSignOut,
}: SystemAccountPageContentProps) {
  return (
    <div className="page system-page system-account-page">
      <PageHeader
        eyebrow="Settings"
        title="Account"
        description="Your signed-in identity."
      />

      <section
        className="system-section"
        aria-label="Account details"
      >
        <dl className="system-detail-list">
          <div className="system-detail-row">
            <dt>Name</dt>
            <dd>{name}</dd>
          </div>

          <div className="system-detail-row">
            <dt>Email</dt>
            <dd>{email}</dd>
          </div>
        </dl>

        <p className="system-note">
          Signed in with Auth0
        </p>

        <button
          className="secondary-button system-sign-out"
          type="button"
          onClick={onSignOut}
        >
          Sign out
        </button>
      </section>
    </div>
  );
}

export function SystemAccountPage() {
  const { logout, user } = useAuth0();

  return (
    <SystemAccountPageContent
      name={user?.name || "—"}
      email={user?.email || "—"}
      onSignOut={() => {
        void logout({
          logoutParams: {
            returnTo: window.location.origin,
          },
        });
      }}
    />
  );
}
