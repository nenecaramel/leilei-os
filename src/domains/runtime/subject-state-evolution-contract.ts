export type SubjectStateEvolutionRunMode =
  | "full"
  | "settlement_catch_up";

export interface SubjectStateEvolutionRunner {
  runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    limit?: number;
    mode?: SubjectStateEvolutionRunMode;
  }): Promise<unknown>;
}
