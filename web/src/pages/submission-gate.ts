export type SubmissionGate = {
  enter(): boolean;
  leave(): void;
};

export function createSubmissionGate(): SubmissionGate {
  let active = false;
  return {
    enter() {
      if (active) return false;
      active = true;
      return true;
    },
    leave() {
      active = false;
    },
  };
}
