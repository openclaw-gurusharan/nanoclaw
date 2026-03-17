type NoResultOutputInput = {
  resultCount: number;
  lastAssistantText: string | null;
  newSessionId?: string;
  agentId?: string;
  agentType?: string;
};

type AgentRunnerOutput = {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
  agentId?: string;
  agentType?: string;
};

export function buildNoResultEventFailureOutput(
  input: NoResultOutputInput,
): AgentRunnerOutput | null {
  if (input.resultCount !== 0) return null;
  const assistantText = input.lastAssistantText?.trim();
  if (!assistantText) return null;

  const excerpt = assistantText.replace(/\s+/g, ' ').slice(0, 200);
  return {
    status: 'error',
    result: null,
    newSessionId: input.newSessionId,
    error: `Claude SDK emitted assistant text but no result event; refusing silent fallback. Assistant excerpt: ${excerpt}`,
    agentId: input.agentId,
    agentType: input.agentType,
  };
}
