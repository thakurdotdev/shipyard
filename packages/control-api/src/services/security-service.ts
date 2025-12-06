export const SecurityService = {
  validateBuildCommand(command: string) {
    const dangerousPatterns = [
      "rm -rf",
      "sudo",
      "wget",
      "curl",
      "eval",
      "|",
      ";",
      "&&",
      ">",
      "<",
      "/etc/passwd",
      "/etc/shadow",
      "/bin/sh",
      "/bin/bash",
    ];

    const allowedPrefixes = ["npm", "yarn", "pnpm", "bun", "echo", "ls"];

    // 1. Check for dangerous patterns
    for (const pattern of dangerousPatterns) {
      if (command.includes(pattern)) {
        throw new Error(`Command contains dangerous pattern: "${pattern}"`);
      }
    }

    // 2. Enforce allowlist for command start
    // This assumes simple commands like "npm run build" or "bun build"
    const startsWithAllowed = allowedPrefixes.some((prefix) =>
      command.trim().startsWith(prefix),
    );

    if (!startsWithAllowed) {
      throw new Error(
        `Command must start with one of: ${allowedPrefixes.join(", ")}`,
      );
    }

    return true;
  },
};
