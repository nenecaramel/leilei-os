const fail = code => Object.assign(new Error(code), { code });
const clean = value => String(value ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, 160);

// Desktop ids each window has carried (Rewind/compaction rotate the CLI session
// while the window stays), including the window it was forked from.
function windowAncestry(session, sessions) {
  const ids = new Set(), seen = new Set();
  for (let current = session; current && !seen.has(current.desktopSessionId); ) {
    seen.add(current.desktopSessionId);
    for (const id of [current.providerSessionId, ...(current.priorProviderSessionIds ?? []), ...(current.rewindEdges ?? []).map(edge => edge.parent)]) if (id) ids.add(id);
    // A window id is local_<its first CLI session>, so the origin survives the
    // forked-from window being closed or cleaned up.
    if (current.forkedFromDesktopSessionId) ids.add(current.forkedFromDesktopSessionId.slice('local_'.length));
    current = current.forkedFromDesktopSessionId ? sessions.find(other => other.desktopSessionId === current.forkedFromDesktopSessionId) : null;
  }
  return ids;
}

export function buildSwitchChoices(mode, conversations, sessions, { localSessionIds = new Set(), historyMode = "complete" } = {}) {
  if (!['desktop', 'leileios'].includes(mode)) throw fail('INVALID_SWITCH_MODE');
  if (mode === 'desktop') return conversations.map(c => {
    // Hand back the branch LeileiOS is actually on (its head checkpoint session).
    const matches = sessions.filter(s => s.providerSessionId === c.providerSessionId);
    const s = matches[0];
    const localOnly = matches.length === 0 && localSessionIds.has(c.providerSessionId);
    const reason = c.busy ? 'NATIVE_CONVERSATION_BUSY'
      : !c.providerSessionId || !c.sourceSessionId ? 'NATIVE_SOURCE_BINDING_REQUIRED'
      : matches.length > 1 ? 'AMBIGUOUS_NATIVE_SELECTION'
      : localOnly ? null
      : matches.length === 0 ? 'NATIVE_SESSION_FILE_REQUIRED'
      : s.error ?? (!(historyMode === 'continuation' ? s.continuationReady === true : s.history?.state === 'complete') ? s.history?.reason ?? 'NATIVE_HISTORY_UNAVAILABLE' : null);
    return { ...c, sessionId: c.providerSessionId, desktopSessionId: s?.desktopSessionId ?? null, nativeRevision: s?.nativeRevision, historyRevision: s?.historyRevision,
      branch: 'current', opensNewWindow: localOnly, reason };
  });
  return sessions.map(s => {
    // Existing attachment wins over a newly generated conversation identity.
    // Multiple bindings require an explicit branch operation, not a guess.
    const exact = conversations.filter(c => (historyMode !== "continuation" && c.sourceSessionId === s.providerSessionId) || c.providerSessionId === s.providerSessionId);
    const archived = historyMode === "continuation" ? [] : conversations.filter(c => (c.sourceLineage ?? []).includes(s.providerSessionId));
    const ancestry = windowAncestry(s, sessions);
    // A rotated window may continue its conversation; the server accepts it only
    // if every synchronized message is carried unchanged.
    const continued = historyMode === "continuation" || exact.length || archived.length ? [] : conversations.filter(c => c.sourceSessionId && ancestry.has(c.sourceSessionId));
    const matches = exact.length ? exact : archived.length ? archived : continued;
    const c = matches[0];
    const duplicates = sessions.filter(other => other.providerSessionId === s.providerSessionId);
    const branch = archived.length && !exact.length ? 'archive' : c ? 'current' : 'new';
    const reason = s.error ?? (!(historyMode === 'continuation' ? s.continuationReady === true : s.history?.state === 'complete') ? s.history?.reason ?? 'NATIVE_HISTORY_UNAVAILABLE'
      : !s.providerSessionId ? 'NATIVE_SELECTION_NOT_FOUND'
      : branch === 'archive' ? 'ARCHIVED_NATIVE_SESSION'
      : matches.length > 1 || duplicates.length > 1 ? 'AMBIGUOUS_NATIVE_SELECTION'
      : c?.busy ? 'NATIVE_CONVERSATION_BUSY'
      : c && !c.sourceSessionId ? 'NATIVE_SOURCE_BINDING_REQUIRED' : null);
    return { ...(c ?? {}), title: s.title, updatedAt: s.updatedAt, sessionId: s.providerSessionId,
      desktopSessionId: s.desktopSessionId, nativeRevision: s.nativeRevision, historyRevision: s.historyRevision,
      conversationId: c?.conversationId ?? s.providerSessionId, branch, reason };
  });
}

export function pickSwitchChoice(choices, answer) {
  const input = String(answer).trim();
  if (/^(q|quit|取消)$/i.test(input)) throw fail('SELECTION_CANCELLED');
  if (!/^[1-9][0-9]*$/.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) > choices.length) throw fail('INVALID_SELECTION');
  const selected = choices[Number(input) - 1];
  if (selected.reason) throw fail(selected.reason);
  return selected;
}

export function formatSwitchMenu(choices) {
  const label = { current: '当前分支', archive: '存档', new: '新对话' };
  return choices.map((c, i) => `${i + 1}. [${label[c.branch] ?? '当前分支'}] ${clean(c.title) || '未命名对话'} | ${clean(c.updatedAt) || '时间未知'}\n   conversation: ${clean(c.conversationId) || '首次恢复'} | session: ${clean(c.sessionId) || '不可用'}${c.opensNewWindow ? ' | 将在官端新开窗口' : ''}${c.reason ? ` | 不可切换: ${clean(c.reason)}` : ''}`).join('\n');
}

export async function selectAndSwitch(mode, { isTTY, load, ask, display, run }) {
  if (!isTTY) throw fail('INTERACTIVE_TERMINAL_REQUIRED');
  const choices = await load(mode);
  if (!choices.length) throw fail('NATIVE_SELECTION_NOT_FOUND');
  display(formatSwitchMenu(choices));
  const selected = pickSwitchChoice(choices, await ask('请选择编号（q 取消）：'));
  const refreshed = await load(mode);
  const matches = refreshed.filter(c => c.conversationId === selected.conversationId && c.desktopSessionId === selected.desktopSessionId);
  if (matches.length !== 1 || ['sessionId', 'headMessageId', 'providerCheckpointId', 'sourceSessionId', 'nativeRevision', 'historyRevision'].some(key => matches[0][key] !== selected[key])) throw fail('STALE_NATIVE_SELECTION');
  if (matches[0].reason) throw fail(matches[0].reason);
  return run(mode, matches[0]);
}
