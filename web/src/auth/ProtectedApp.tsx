import { useAuth0 } from "@auth0/auth0-react";
import type { PropsWithChildren } from "react";
import { SettingsProvider } from "../settings/SettingsProvider";

export function ProtectedApp({
  children,
}: PropsWithChildren) {
  const {
    error,
    isAuthenticated,
    isLoading,
    loginWithRedirect,
  } = useAuth0();

  if (isLoading) {
    return (
      <main className="auth-screen auth-screen-loading">
        <div
          className="loading-orb"
          aria-label="正在检查登录状态"
        />
      </main>
    );
  }

  if (error) {
    return (
      <main className="auth-screen auth-screen-error">
        <section
          className="auth-minimal auth-minimal-error"
          aria-label="登录错误"
        >
          <h1>暂时无法登录</h1>
          <p>{error.message}</p>

          <button
            className="auth-text-action"
            type="button"
            onClick={() =>
              loginWithRedirect()
            }
          >
            重新登录
          </button>
        </section>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="auth-screen auth-screen-login">
        <section
          className="auth-minimal"
          aria-label="登录 Leilei OS"
        >
          <h1>Leilei OS</h1>

          <button
            className="auth-text-action"
            type="button"
            onClick={() =>
              loginWithRedirect()
            }
          >
            使用 Auth0 登录
          </button>
        </section>
      </main>
    );
  }

  return (
    <SettingsProvider>
      {children}
    </SettingsProvider>
  );
}
