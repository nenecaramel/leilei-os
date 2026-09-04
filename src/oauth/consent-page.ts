export type ConsentPageView = {
  transactionId: string;
  csrfToken: string;
  clientName: string;
  clientIdHostname: string;
  redirectHostname: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/gu, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "'": return "&#39;";
      case '"': return "&quot;";
      default: return character;
    }
  });
}

export function renderConsentPage(view: ConsentPageView): string {
  const transactionId = escapeHtml(view.transactionId);
  const csrfToken = escapeHtml(view.csrfToken);
  const clientName = escapeHtml(view.clientName);
  const clientIdHostname = escapeHtml(view.clientIdHostname);
  const redirectHostname = escapeHtml(view.redirectHostname);
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Authorize Leilei OS</title></head>
  <body>
    <main>
      <h1>Authorize Leilei OS</h1>
      <p><strong>${clientName}</strong> is requesting access to Leilei OS.</p>
      <p>Client host: <code>${clientIdHostname}</code></p>
      <p>Redirect host: <code>${redirectHostname}</code></p>
      <form method="post" action="/oauth/consent">
        <input type="hidden" name="transaction" value="${transactionId}">
        <input type="hidden" name="csrf_token" value="${csrfToken}">
        <button type="submit" name="decision" value="approve">Approve</button>
        <button type="submit" name="decision" value="deny">Deny</button>
      </form>
    </main>
  </body>
</html>`;
}
