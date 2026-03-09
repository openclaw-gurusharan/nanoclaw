declare module '../scripts/workflow/github-project-sync.js' {
  export function extractExecutionBoard(
    body: string | null | undefined,
  ): string | null;
  export function resolveBoardKey(
    boardValue: string | null | undefined,
  ): 'platform' | 'delivery';
  export function extractIssueNumbers(
    text: string | null | undefined,
  ): number[];
  export function deriveIssueStatus(args: {
    action: string;
    currentStatus: string | null;
    issueState: string;
    labels: string[];
    assigneeCount: number;
  }): string;
  export function derivePullRequestStatus(args: {
    issueState: string;
    labels: string[];
    assigneeCount: number;
    pullRequestState: string;
    isDraft: boolean;
    merged: boolean;
    currentStatus: string | null;
  }): string;
}
