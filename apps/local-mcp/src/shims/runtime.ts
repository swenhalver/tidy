/**
 * Local stand-ins for hosted-only web modules: account activity broadcasting,
 * error reporting, Next.js cache revalidation, and the GitHub, Linear and ChatGPT
 * widget integrations, which all need a Tidy account.
 */
import type { McpServer } from "@modelcontextprotocol/server";

type Observer = (phase: string, details?: Record<string, unknown>) => Promise<void>;

/** Hosted activity publishes progress to collaborators; locally there is no one to notify. */
export class McpActivity {
  async run<T>(
    _tool: string,
    _input: Record<string, unknown>,
    operation: (observe: Observer) => Promise<T>,
  ): Promise<T> {
    return operation(async () => {});
  }
}

/** Local errors are the user's own, so report their message instead of a generic fallback. */
export function actionError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function revalidatePath() {}

export function registerGitHubTools(_server: McpServer, _userId: string) {}
export function registerLinearTools(_server: McpServer, _userId: string) {}
export function registerPluginTools(_server: McpServer, _userId: string) {}
