const fail = code => Object.assign(new Error(code), { code });
const clean = value => String(value ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, 160);

export function buildSwitchChoices(mode, conversations, sessions) {
  if (!['desktop', 'leileios'].includes(mode)) throw fail('INVALID_SWITCH_MODE');
  if (mode === 'desktop') return conversations.map(c => {
    const matches = sessions.filter(s => s.providerSessionId === c.providerSessionId);
    const s = matches[0];
    const reason = c.busy ? 'NATIVE_CONVERSATION_BUSY'
      : matches.length === 0 ? 'DESKTOP_INDEX_REQUIRED'
      : matches.length > 1 ? 'AMBIGUOUS_NATIVE_SELECTION'
      : s.error ?? (s.history?.state !== 'complete' ? s.history?.reason ?? 'NATIVE_HISTORY_UNAVAILABLE'
        : !c.sourceSessionId || c.sourceSessionId !== c.providerSessionId ? 'NATIVE_SOURCE_BINDING_REQUIRED' : null);
    return { ...c, sessionId: c.providerSessionId, desktopSessionId: s?.desktopSessionId, nativeRevision: s?.nativeRevision, reason };
  });
  return sessions.map(s => {
    // Existing attachment wins over a newly generated conversation identity.
    // Multiple bindings require an explicit branch operation, not a guess.
    const matches = conversations.filter(c => c.sourceSessionId === s.providerSessionId || c.providerSessionId === s.providerSessionId);
    const c = matches[0];
    const duplicates = sessions.filter(other => other.providerSessionId === s.providerSessionId);
    const reason = s.error ?? (s.history?.state !== 'complete' ? s.history?.reason ?? 'NATIVE_HISTORY_UNAVAILABLE'
      : !s.providerSessionId ? 'NATIVE_SELECTION_NOT_FOUND'
      : matches.length > 1 || duplicates.length > 1 ? 'AMBIGUOUS_NATIVE_SELECTION'
      : c?.busy ? 'NATIVE_CONVERSATION_BUSY'
      : c && c.sourceSessionId !== s.providerSessionId ? 'NATIVE_SOURCE_BINDING_REQUIRED' : null);
    return { ...(c ?? {}), title: s.title, updatedAt: s.updatedAt, sessionId: s.providerSessionId,
      desktopSessionId: s.desktopSessionId, nativeRevision: s.nativeRevision, conversationId: c?.conversationId ?? s.providerSessionId, reason };
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
  return choices.map((c, i) => `${i + 1}. ${clean(c.title) || '未命名对话'} | ${clean(c.updatedAt) || '时间未知'}\n   conversation: ${clean(c.conversationId) || '首次恢复'} | session: ${clean(c.sessionId) || '不可用'}${c.reason ? ` | 不可切换: ${clean(c.reason)}` : ''}`).join('\n');
}

export async function selectAndSwitch(mode, { isTTY, load, ask, display, run }) {
  if (!isTTY) throw fail('INTERACTIVE_TERMINAL_REQUIRED');
  const choices = await load(mode);
  if (!choices.length) throw fail('NATIVE_SELECTION_NOT_FOUND');
  display(formatSwitchMenu(choices));
  const selected = pickSwitchChoice(choices, await ask('请选择编号（q 取消）：'));
  const refreshed = await load(mode);
  const matches = refreshed.filter(c => c.conversationId === selected.conversationId && c.desktopSessionId === selected.desktopSessionId);
  if (matches.length !== 1 || ['sessionId', 'headMessageId', 'providerCheckpointId', 'sourceSessionId', 'nativeRevision'].some(key => matches[0][key] !== selected[key])) throw fail('STALE_NATIVE_SELECTION');
  if (matches[0].reason) throw fail(matches[0].reason);
  return run(mode, matches[0]);
}
