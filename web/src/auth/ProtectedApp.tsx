import { useAuth0 } from "@auth0/auth0-react";
import type { PropsWithChildren } from "react";

export function ProtectedApp({ children }: PropsWithChildren) {
  const { error, isAuthenticated, isLoading, loginWithRedirect } = useAuth0();

  if (isLoading) {
    return (
      <main className="auth-screen">
        <div className="loading-orb" aria-label="正在检查登录状态" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <p className="eyebrow">Authentication error</p>
          <h1>暂时无法登录</h1>
          <p>{error.message}</p>
          <button className="primary-button" onClick={() => loginWithRedirect()}>
            重新登录
          </button>
        </section>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="brand-mark" aria-hidden="true">
            L
          </div>
          <p className="eyebrow">Personal operations, quietly organized</p>
          <h1>欢迎回到 Leilei OS</h1>
          <p>使用与你现有 MCP 身份一致的 Auth0 账号进入个人管理端。</p>
          <button className="primary-button" onClick={() => loginWithRedirect()}>
            使用 Auth0 登录
          </button>
        </section>
      </main>
    );
  }

  return children;
}
