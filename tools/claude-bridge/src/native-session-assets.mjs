import { extractNativeHistoryAsset } from './native-session-history.mjs';
const fail = code => Object.assign(new Error(code), { code });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// Only bytes embedded in the pinned native snapshot. Never read source paths,
// fetch historical URLs, alter native records or forward relay auth to storage.
export async function materializeNativeSessionHistoryAssets({ history, conversationId, request, uploadImpl = fetch }) {
  let materialized = 0, unavailable = 0;
  for (const message of history.projection.messages) for (const block of message.blocks) {
    if (!['image', 'file'].includes(block.kind) || !block.payload?.source_entry_uuid) continue;
    const reference = block.payload;
    if (reference.source_type !== 'base64') { unavailable++; continue; }
    const input = {
      conversationId, sessionId: history.nativeSnapshot.sessionId, expectedRevision: history.nativeSnapshot.revision,
      sourceEntryUuid: reference.source_entry_uuid, sourceBlockOrdinal: reference.source_block_ordinal,
    };
    const metadata = await request('asset', input);
    const asset = extractNativeHistoryAsset({ ...history.nativeSnapshot, entries: history.nativeSnapshot.displayAssets?.entries ?? history.nativeSnapshot.entries }, reference, {
      expectedRevision: input.expectedRevision, maxBytes: 24 * 1024 * 1024,
    });
    if (!metadata || metadata.sha256 !== asset.sha256 || metadata.sizeBytes !== asset.sizeBytes || metadata.mimeType !== asset.mimeType
      || metadata.kind !== (block.kind === 'image' ? 'image' : 'file') || typeof metadata.filename !== 'string') throw fail('NATIVE_ASSET_MISMATCH');
    if (metadata.attachmentId) {
      if (!uuid.test(metadata.attachmentId)) throw fail('NATIVE_ASSET_MISMATCH');
      materialized++; continue;
    }
    const slot = await request('attachment-upload-slot', {
      filename: metadata.filename, mime_type: asset.mimeType,
      size_bytes: asset.sizeBytes, sha256: asset.sha256, kind: metadata.kind,
    });
    const id = slot?.attachment?.attachmentId;
    let url;
    try { url = new URL(slot?.upload?.url); } catch { throw fail('NATIVE_ASSET_UPLOAD_FAILED'); }
    if (!uuid.test(id ?? '') || slot.upload.method !== 'PUT' || url.username || url.password || url.hash
      || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
      || slot.upload.headers?.['content-type'] !== asset.mimeType
      || (slot.upload.headers?.['x-amz-meta-sha256'] ?? slot.upload.headers?.['x-leileios-sha256']) !== asset.sha256
      || Object.keys(slot.upload.headers).some(key => !/^(content-type|x-amz-meta-sha256|x-leileios-sha256)$/i.test(key))) throw fail('NATIVE_ASSET_UPLOAD_FAILED');
    try {
      const response = await uploadImpl(url.href, {
        method: 'PUT', headers: slot.upload.headers, body: asset.bytes,
        redirect: 'error', signal: AbortSignal.timeout(60_000),
      });
      await response.body?.cancel();
      if (!response.ok) throw fail('NATIVE_ASSET_UPLOAD_FAILED');
    } catch { throw fail('NATIVE_ASSET_UPLOAD_FAILED'); }
    const completed = await request('attachment-complete/' + id, {});
    const a = completed?.attachment;
    if (a?.attachmentId !== id || a.sha256 !== asset.sha256 || a.sizeBytes !== asset.sizeBytes || a.mimeType !== asset.mimeType
      || !['ready', 'bound'].includes(a.status)) throw fail('NATIVE_ASSET_MISMATCH');
    const bound = await request('asset', { ...input, attachmentId: id });
    if (!uuid.test(bound?.attachmentId ?? '') || bound.sha256 !== asset.sha256 || bound.sizeBytes !== asset.sizeBytes
      || bound.mimeType !== asset.mimeType) throw fail('NATIVE_ASSET_MISMATCH');
    materialized++;
  }
  return { materialized, unavailable };
}
