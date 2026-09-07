const isCapabilityObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const detectMissingHostCapabilities = (capabilities: unknown): string[] => {
  if (!isCapabilityObject(capabilities)) return ["serverTools", "updateModelContext", "message"];

  const missing: string[] = [];
  if (!isCapabilityObject(capabilities.serverTools)) missing.push("serverTools");
  if (!isCapabilityObject(capabilities.updateModelContext)) missing.push("updateModelContext");
  if (!isCapabilityObject(capabilities.message)) missing.push("message");
  return missing;
};
