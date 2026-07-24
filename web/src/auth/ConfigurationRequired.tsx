export function ConfigurationRequired() {
  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-config-title">
        <div className="brand-mark" aria-hidden="true">
          L
        </div>
        <p className="eyebrow">Leilei OS Web</p>
        <h1 id="auth-config-title">等待 Auth0 配置</h1>
        <p>
          复制 <code>.env.example</code> 为本地 <code>.env</code>，填写独立 Web
          Application 的 Auth0 配置后即可登录。
        </p>
      </section>
    </main>
  );
}
