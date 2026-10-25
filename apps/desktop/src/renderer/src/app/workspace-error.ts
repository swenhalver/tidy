import { errorMessage } from "@tidy/ui/errors";

export type WorkspaceError = {
  original?: unknown;
  projectId?: string;
  text: string;
};

export const errorText = (error: unknown) =>
  errorMessage(error, "The operation could not be completed. Please try again.");
