export type NativeLiveDistillationScheduleInput = {
  userId: string;
  conversationId: string;
};

export interface NativeLiveDistillationTrigger {
  schedule(input: NativeLiveDistillationScheduleInput): void;
}
