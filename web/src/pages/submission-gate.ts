export type SubmissionGate = {
  enter(): boolean;
  leave(): void;
};

const UNSAVED_CHANGES_MESSAGE =
  "当前有未保存的内容，确定要离开吗？";

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

export type MutationOwnership = {
  begin(): number;
  invalidate(): void;
  owns(ticket: number): boolean;
};

export function createMutationOwnership(): MutationOwnership {
  let version = 0;
  return {
    begin() {
      version += 1;
      return version;
    },
    invalidate() {
      version += 1;
    },
    owns(ticket) {
      return ticket === version;
    },
  };
}

export function confirmUnsavedChanges(
  dirty: boolean,
  confirm: (message: string) => boolean,
): boolean {
  return !dirty || confirm(UNSAVED_CHANGES_MESSAGE);
}
