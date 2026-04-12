import type { RegisteredGroup } from './types.js';

export const MAIN_ONECLI_AGENT_IDENTIFIER = 'andy-bot';
export const MAIN_ONECLI_AGENT_NAME = 'Andy Bot';

export function normalizeOneCliAgentIdentifier(groupFolder: string): string {
  return groupFolder.toLowerCase().replace(/_/g, '-');
}

export function resolveOneCliAgent(
  group: Pick<RegisteredGroup, 'folder' | 'name' | 'isMain'>,
): {
  identifier: string;
  name: string;
} {
  if (group.isMain) {
    return {
      identifier: MAIN_ONECLI_AGENT_IDENTIFIER,
      name: MAIN_ONECLI_AGENT_NAME,
    };
  }

  return {
    identifier: normalizeOneCliAgentIdentifier(group.folder),
    name: group.name,
  };
}
