export function isContainerTimeoutError(error?: string | null): boolean {
  if (!error) return false;
  return /Container timed out \((?:no_output_timeout|hard_timeout) after \d+ms\)/.test(
    error,
  );
}

export function shouldRetryWorkerAgentFailure(params: {
  isWorkerRun: boolean;
  error?: string | null;
}): boolean {
  if (!params.isWorkerRun) return true;
  if (isContainerTimeoutError(params.error)) return false;
  return true;
}
