# Phase 1 acceptance checklist

## Local

- [ ] Dependencies install successfully.
- [ ] TypeScript type checking passes.
- [ ] Production build succeeds.
- [ ] `/health` returns HTTP 200.
- [ ] MCP initialization succeeds.
- [ ] `tools/list` contains only `hello`.
- [ ] `tools/call` for `hello` returns structured data.

## Remote

- [ ] The service is reachable through a stable HTTPS URL.
- [ ] The HTTPS certificate is valid.
- [ ] The hosting platform preserves POST, GET, DELETE, and MCP response headers.
- [ ] ChatGPT's tool scan discovers `hello`.
- [ ] A ChatGPT conversation can invoke `hello`.

## Out of scope

- Memory
- Diary
- Tasks
- PostgreSQL
- OpenAI API
- Chat UI
- Agent orchestration
