import { ActiveUserAuthorizationError } from "../../domains/require-active-user.js";

export type NotionUserAuthorizationDependencies = {
  getAuthenticatedUserId: () => string;
  requireActiveUser?: () => Promise<string>;
};

export async function authorizeNotionUser(
  dependencies: NotionUserAuthorizationDependencies,
): Promise<string> {
  if (dependencies.requireActiveUser) {
    return dependencies.requireActiveUser();
  }
  return dependencies.getAuthenticatedUserId();
}

export function isActiveUserAuthorizationError(
  error: unknown,
): error is ActiveUserAuthorizationError {
  return error instanceof ActiveUserAuthorizationError;
}
