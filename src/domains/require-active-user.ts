export type DurableUserStatus = {
  status: "active" | "disabled";
};

export type ActiveUserRepository = {
  findUserById(userId: string): Promise<DurableUserStatus | null>;
};

export type ActiveUserErrorCode = "USER_NOT_FOUND" | "USER_DISABLED";

export class ActiveUserAuthorizationError extends Error {
  constructor(
    public readonly code: ActiveUserErrorCode,
  ) {
    super("Authenticated user is unavailable.");
    this.name = "ActiveUserAuthorizationError";
  }
}

export async function requireActiveUser(
  repository: ActiveUserRepository,
  userId: string,
): Promise<string> {
  const normalized = userId.trim();
  if (!normalized) {
    throw new ActiveUserAuthorizationError("USER_NOT_FOUND");
  }

  const user = await repository.findUserById(normalized);
  if (!user) {
    throw new ActiveUserAuthorizationError("USER_NOT_FOUND");
  }
  if (user.status !== "active") {
    throw new ActiveUserAuthorizationError("USER_DISABLED");
  }
  return normalized;
}
