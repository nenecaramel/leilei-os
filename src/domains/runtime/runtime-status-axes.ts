export const GENERATION_STATUSES = [
  "started",
  "producing",
  "committed",
  "aborted",
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const PRESENTATION_STATUSES = [
  "not_presented",
  "presented",
] as const;
export type PresentationStatus = (typeof PRESENTATION_STATUSES)[number];

export const PATH_STATUSES = ["current", "superseded"] as const;
export type PathStatus = (typeof PATH_STATUSES)[number];

export const SETTLEMENT_STATUSES = [
  "unsettled",
  "settled",
  "rejected",
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const VALIDITY_STATUSES = [
  "valid",
  "invalidated",
  "tombstoned",
] as const;
export type ValidityStatus = (typeof VALIDITY_STATUSES)[number];

export type RuntimeStatusAxes = {
  generationStatus: GenerationStatus;
  presentationStatus: PresentationStatus;
  pathStatus: PathStatus;
  settlementStatus: SettlementStatus;
  validityStatus: ValidityStatus;
};

export function isConsolidationEligible(status: RuntimeStatusAxes): boolean {
  return (
    status.generationStatus === "committed"
    && status.presentationStatus === "presented"
    && status.pathStatus === "current"
    && status.settlementStatus === "settled"
    && status.validityStatus === "valid"
  );
}

export function isProvisional(status: RuntimeStatusAxes): boolean {
  return !isConsolidationEligible(status);
}
