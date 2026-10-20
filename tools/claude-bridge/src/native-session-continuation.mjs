import path from 'node:path';
import { homedir } from 'node:os';
import { readNativeContinuationEvidence } from './native-session-inspection.mjs';
import { preflightNativeSessionSwitch } from './native-session-switch-preflight.mjs';
import { nativeHistoryRequest, assertNativeHandoffRecoveryClear, launchDesktopNativeSession } from './native-session-switch-restore.mjs';
import { requestNativeSessionDrain, requestNativeSessionResume } from './native-session-daemon-drain.mjs';
import { pinDrainedNativeSource, settleDrainedNativeSource } from './native-session-drain-settle.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const fail = code => Object.assign(new Error(code), { code });

export const attachDesktopNativeContinuation = options => switchContinuation(options, 'leileios');
export const handoffNativeContinuationToDesktop = options => switchContinuation(options, 'desktop');

async function switchContinuation({ input, conversationId, relayUrl, relayToken, fetchImpl = fetch,
  recoveryDirectory = input?.recoveryDirectory ?? path.join(homedir(), '.leileios'), launchImpl = launchDesktopNativeSession,
  sleep, retryDelaysMs, drainSettle }, owner) {
  if (!uuid.test(conversationId ?? '')) throw fail('INVALID_NATIVE_RESTORE_ENDPOINT');
  input = { ...input, historyMode: 'continuation', followNativeContinuation: true };
  const request = nativeHistoryRequest({ relayUrl, relayToken, fetchImpl, sleep, retryDelaysMs });
  let state, begin;
  const readState = async sessionId => {
    const value = await request('continuation-state', { conversationId, sessionId });
    if (!value || !(value.expectedHeadMessageId === null || uuid.test(value.expectedHeadMessageId ?? '')) ||
      !(value.expectedRevision === null || hash.test(value.expectedRevision ?? '')) ||
      ![null, 'desktop', 'leileios', 'releasing'].includes(value.owner) ||
      !(value.providerSessionId === null || uuid.test(value.providerSessionId ?? '')) ||
      !(value.providerCheckpointId === null || uuid.test(value.providerCheckpointId ?? ''))) throw fail('NATIVE_RESTORE_INVALID_RESPONSE');
    return value;
  };
  if (owner === 'desktop') {
    state = await readState(input.expectedSessionId);
    // An exhausted begin may already have committed on the server. Without R1
    // we cannot cancel safely; manual attach recovers its releasing owner.
    begin = await request('continuation-release-begin', { conversationId, sessionId: input.expectedSessionId,
      expectedHeadMessageId: state.expectedHeadMessageId, expectedRevision: state.expectedRevision });
    if (!begin || !['releasing', 'already_current'].includes(begin.outcome) || begin.owner !== 'releasing' ||
      begin.conversationId !== conversationId || begin.headMessageId !== state.expectedHeadMessageId ||
      begin.providerSessionId !== input.expectedSessionId || !hash.test(begin.expectedRevision ?? '')) throw fail('NATIVE_RELEASE_BEGIN_UNCONFIRMED');
  }
  try {
    const pinned = owner === 'desktop' ? await pinDrainedNativeSource(input) : null;
    const drain = owner === 'desktop' ? await requestNativeSessionDrain({ recoveryDirectory, conversationId, providerSessionId: input.expectedSessionId }) : null;
    if (drain && !drain.ready) throw fail('NATIVE_DAEMON_DRAIN_UNCONFIRMED');
    if (drain) input = await settleDrainedNativeSource(input, pinned, drainSettle);
    await assertNativeHandoffRecoveryClear(recoveryDirectory);
    const selection = await preflightNativeSessionSwitch(input);
    const evidence = await readNativeContinuationEvidence(input);
    if (owner === 'leileios') state = await readState(selection.providerSessionId);
    if (state.providerSessionId !== null && (state.providerSessionId !== selection.providerSessionId || state.effectiveWorkingDirectory !== selection.workingDirectory)) throw fail('EXPLICIT_BRANCH_SELECTION_REQUIRED');
    if (owner === 'desktop' && (!state.providerCheckpointId || !evidence.completedTurnCheckpointIds.includes(state.providerCheckpointId))) throw fail('CANONICAL_CHECKPOINT_CHANGED');
    if (state.providerCheckpointId && !evidence.checkpointIds.includes(state.providerCheckpointId)) throw fail('EXPLICIT_BRANCH_SELECTION_REQUIRED');
    // Fence the local source again after the network round trip. Server locks and
    // CAS protect the canonical state; this guard protects the native file/index.
    await preflightNativeSessionSwitch(input);
    await assertNativeHandoffRecoveryClear(recoveryDirectory);
    const result = await request(owner === 'desktop' ? 'continuation-release' : 'continuation-attach', {
      conversationId, sessionId: selection.providerSessionId, checkpointId: selection.providerCheckpointId,
      revision: selection.nativeRevision, effectiveWorkingDirectory: selection.workingDirectory,
      expectedHeadMessageId: state.expectedHeadMessageId, expectedRevision: begin?.expectedRevision ?? state.expectedRevision,
      checkpointIds: evidence.checkpointIds, completedTurnCheckpointIds: evidence.completedTurnCheckpointIds,
    });
    if (!result || !['attached', 'already_current'].includes(result.outcome) || result.owner !== owner || result.inserted !== 0 ||
      result.conversationId !== conversationId || result.headMessageId !== state.expectedHeadMessageId ||
      result.providerSessionId !== selection.providerSessionId || result.providerCheckpointId !== selection.providerCheckpointId) throw fail('NATIVE_RESTORE_INVALID_RESPONSE');
    await preflightNativeSessionSwitch(input);
    await assertNativeHandoffRecoveryClear(recoveryDirectory);
    if (owner === 'desktop') await launchImpl({ ...selection, configDirectory: input.configDirectory });
    // A running daemon still fences this conversation from the earlier Desktop
    // handoff drain. Only after the server attach may it accept turns again.
    const resumed = owner === 'leileios' ? await requestNativeSessionResume({ recoveryDirectory, conversationId, providerSessionId: selection.providerSessionId }) : null;
    return { ...result, executionAuthorized: false, ...(drain ? { drain } : {}), ...(resumed ? { daemonResumed: true } : {}),
      ...(owner === 'desktop' ? { desktopLaunchRequested: true, desktopSessionVerified: false } : {}) };
  } catch (error) {
    if (begin) {
      const cleanupErrors = [];
      try {
        const cancelled = await request('continuation-release-cancel', { conversationId, expectedRevision: begin.expectedRevision });
        if (!cancelled || !['cancelled', 'already_current'].includes(cancelled.outcome) || cancelled.owner !== 'leileios' ||
          cancelled.conversationId !== conversationId || !hash.test(cancelled.expectedRevision ?? '')) throw fail('NATIVE_RELEASE_CANCEL_UNCONFIRMED');
      } catch (cancelError) { cleanupErrors.push(cancelError); }
      // Always try to lift the local fence, even if server recovery fails.
      // A completed release stays Desktop-owned; manual attach recovers it.
      try { await requestNativeSessionResume({ recoveryDirectory, conversationId, providerSessionId: input.expectedSessionId }); }
      catch (resumeError) { cleanupErrors.push(resumeError); }
      if (cleanupErrors.length) error.cleanupErrors = cleanupErrors;
    }
    throw error;
  }
}
