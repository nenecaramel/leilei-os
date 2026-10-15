/** Old native-history-assets JSONB copies are excluded from all new writes.
 * Current native Session ownership/checkpoint state remains unaffected.
 */
export function assertLegacyAssetWriteAllowed(): never {
  throw Object.assign(new Error("Legacy historical display assets cannot be persisted in Railway."), {
    code: "LEGACY_ASSET_WRITE_DISABLED",
  });
}
