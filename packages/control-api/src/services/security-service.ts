const BUILD_COMMAND_PREFIXES = ['npm', 'yarn', 'pnpm', 'bun', 'echo', 'ls'];
/** Pre-deploy commands run migration CLIs, so package runners and Go are allowed too. */
const PRE_DEPLOY_COMMAND_PREFIXES = ['npm', 'npx', 'yarn', 'pnpm', 'bun', 'node', 'go', 'echo'];

export const SecurityService = {
  validateBuildCommand(command: string, allowedPrefixes: string[] = BUILD_COMMAND_PREFIXES) {
    const dangerousPatterns = [
      'rm -rf',
      'sudo',
      'wget',
      'curl',
      'eval',
      '|',
      ';',
      '>',
      '<',
      '/etc/passwd',
      '/etc/shadow',
      '/bin/sh',
      '/bin/bash',
    ];

    // 1. Check for dangerous patterns (excluding && which we handle specially)
    for (const pattern of dangerousPatterns) {
      if (command.includes(pattern)) {
        throw new Error(`Command contains dangerous pattern: "${pattern}"`);
      }
    }

    // 2. Split by && and validate each part starts with allowed prefix
    const commandParts = command.split('&&').map((part) => part.trim());

    for (const part of commandParts) {
      if (!part) continue; // Skip empty parts

      const startsWithAllowed = allowedPrefixes.some((prefix) => part.startsWith(prefix));

      if (!startsWithAllowed) {
        throw new Error(
          `Each command must start with one of: ${allowedPrefixes.join(', ')}. Invalid: "${part}"`,
        );
      }
    }

    return true;
  },

  /** Empty/whitespace means "no pre-deploy command" and is always valid. */
  validatePreDeployCommand(command: string | null | undefined) {
    if (!command?.trim()) return true;
    if (command.length > 2000) throw new Error('Pre-deploy command is too long');
    return this.validateBuildCommand(command, PRE_DEPLOY_COMMAND_PREFIXES);
  },
};
