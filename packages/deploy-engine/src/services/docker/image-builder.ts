import { existsSync, readFileSync } from 'fs';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { execDocker, execDockerWithStream } from './exec';
import { BuildResult, getImageName } from './types';

/**
 * Dockerfile template types
 */
type FrameworkType = 'nextjs' | 'vite' | 'express' | 'hono' | 'elysia' | 'go';

/**
 * Common entry file patterns for backend apps
 */
const ENTRY_PATTERNS = [
  'src/index.ts',
  'src/index.js',
  'src/server.ts',
  'src/server.js',
  'index.ts',
  'index.js',
  'server.ts',
  'server.js',
];

/**
 * Detect entry file from source directory
 */
function detectEntryFile(sourceDir: string): string | null {
  for (const pattern of ENTRY_PATTERNS) {
    if (existsSync(join(sourceDir, pattern))) {
      return pattern;
    }
  }
  return null;
}

/**
 * Check if package.json has a start script
 */
function hasStartScript(sourceDir: string): boolean {
  const pkgPath = join(sourceDir, 'package.json');
  if (!existsSync(pkgPath)) return false;

  try {
    const content = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    return !!pkg.scripts?.start;
  } catch {
    return false;
  }
}

/**
 * Sanitize a user-provided Dockerfile for security.
 * - Ensures EXPOSE uses our assigned port
 * - Ensures PORT env var is set correctly
 * - Removes potentially dangerous instructions
 */
function sanitizeDockerfile(content: string, internalPort: number): string {
  let lines = content.split('\n');

  // Track if we need to add PORT env
  let hasPortEnv = false;
  let hasExpose = false;

  lines = lines.map((line) => {
    const trimmedLine = line.trim().toUpperCase();

    // Replace any EXPOSE with our port
    if (trimmedLine.startsWith('EXPOSE ')) {
      hasExpose = true;
      return `EXPOSE ${internalPort}`;
    }

    // Ensure PORT env is set correctly
    if (trimmedLine.startsWith('ENV ') && trimmedLine.includes('PORT')) {
      hasPortEnv = true;
      // Replace PORT value with our assigned port
      return line.replace(/PORT\s*=?\s*\d+/i, `PORT=${internalPort}`);
    }

    // Remove dangerous instructions
    if (
      trimmedLine.startsWith('USER ROOT') ||
      trimmedLine.includes('--PRIVILEGED') ||
      trimmedLine.includes('DOCKER.SOCK')
    ) {
      return `# REMOVED FOR SECURITY: ${line}`;
    }

    return line;
  });

  // Add EXPOSE if missing
  if (!hasExpose) {
    lines.push(`EXPOSE ${internalPort}`);
  }

  // Add PORT env if missing
  if (!hasPortEnv) {
    // Find last ENV line or insert before CMD/ENTRYPOINT
    const cmdIndex = lines.findIndex(
      (l) =>
        l.trim().toUpperCase().startsWith('CMD') || l.trim().toUpperCase().startsWith('ENTRYPOINT'),
    );
    if (cmdIndex > -1) {
      lines.splice(cmdIndex, 0, `ENV PORT=${internalPort}`);
    } else {
      lines.push(`ENV PORT=${internalPort}`);
    }
  }

  return lines.join('\n');
}

/**
 * Get Dockerfile content for a framework type.
 * Uses multi-stage builds for smaller production images.
 */
function getDockerfileContent(
  framework: FrameworkType,
  internalPort: number = 3000,
  entryFile?: string,
): string {
  // Determine the CMD based on entry point
  const cmd = entryFile ? `CMD ["bun", "run", "${entryFile}"]` : `CMD ["bun", "run", "start"]`;

  switch (framework) {
    case 'vite':
      // Static sites use nginx:alpine (smallest)
      return `FROM nginx:alpine
COPY dist/ /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]`;

    case 'go':
      // Go: compile a static binary, ship it on a minimal runtime image
      return `FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY . .
RUN go mod download
RUN CGO_ENABLED=0 go build -o app .

FROM alpine:3.20
WORKDIR /app
COPY --from=builder /app/app /app/app
ENV PORT=${internalPort}
EXPOSE ${internalPort}
CMD ["/app/app"]`;

    case 'nextjs':
      // Next.js with multi-stage build
      return `FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=builder /app .
ENV NODE_ENV=production
ENV PORT=${internalPort}
EXPOSE ${internalPort}
${cmd}`;

    default:
      // Backend frameworks (express, hono, elysia) - multi-stage
      return `FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=builder /app .
ENV NODE_ENV=production
ENV PORT=${internalPort}
EXPOSE ${internalPort}
${cmd}`;
  }
}

/**
 * Build a Docker image from an extracted artifact directory.
 */
export async function buildImage(
  projectId: string,
  buildId: string,
  sourceDir: string,
  framework: FrameworkType,
  internalPort: number = 3000,
  onLog?: (message: string) => void,
): Promise<BuildResult> {
  const imageName = getImageName(projectId, buildId);
  const dockerfilePath = join(sourceDir, 'Dockerfile');
  let dockerfileGenerated = false;

  // Check if source directory exists
  if (!existsSync(sourceDir)) {
    return {
      success: false,
      imageName,
      error: `Source directory not found: ${sourceDir}`,
    };
  }

  // Use existing Dockerfile if present, otherwise generate one
  if (existsSync(dockerfilePath)) {
    // Sanitize existing Dockerfile for security
    const originalContent = readFileSync(dockerfilePath, 'utf-8');
    const sanitizedContent = sanitizeDockerfile(originalContent, internalPort);

    if (originalContent !== sanitizedContent) {
      await writeFile(dockerfilePath, sanitizedContent);
      onLog?.(`Using existing Dockerfile (sanitized for security)`);
    } else {
      onLog?.(`Using existing Dockerfile`);
    }
  } else {
    // Detect entry point: use start script if available, otherwise find entry file.
    // Go projects are compiled by the generated Dockerfile, so skip entry detection.
    let entryFile: string | undefined;
    if (framework === 'go') {
      onLog?.(`Go project detected - compiling binary inside the image`);
    } else if (!hasStartScript(sourceDir)) {
      entryFile = detectEntryFile(sourceDir) || undefined;
      if (entryFile) {
        onLog?.(`Detected entry file: ${entryFile}`);
      } else {
        onLog?.(`Warning: No start script or entry file found`);
      }
    }

    const content = getDockerfileContent(framework, internalPort, entryFile);
    await writeFile(dockerfilePath, content);
    onLog?.(`Generated Dockerfile for ${framework}`);
    dockerfileGenerated = true;
  }

  // Build the image (uses layer caching - bun install is cached if package.json unchanged)
  onLog?.(`Building Docker image: ${imageName}`);

  const result = await execDockerWithStream(['build', '-t', imageName, sourceDir], (line) =>
    onLog?.(line),
  );

  // Cleanup generated Dockerfile
  if (existsSync(dockerfilePath)) {
    await unlink(dockerfilePath).catch(() => {});
  }

  if (result.exitCode !== 0) {
    return {
      success: false,
      imageName,
      error: result.error || 'Docker build failed',
    };
  }

  onLog?.(`Image built successfully: ${imageName}`);
  return { success: true, imageName };
}

/**
 * Remove a Docker image.
 */
export async function removeImage(imageName: string): Promise<boolean> {
  const result = await execDocker(['rmi', '-f', imageName]);
  return result.exitCode === 0;
}

/**
 * Prune old images for a project, keeping only the latest N.
 */
export async function pruneProjectImages(projectId: string, keepCount: number = 3): Promise<void> {
  const prefix = `thakur-deploy/${projectId.slice(0, 8)}`;

  // List images with this prefix
  const result = await execDocker([
    'images',
    '--format',
    '{{.Repository}}:{{.Tag}} {{.CreatedAt}}',
    '--filter',
    `reference=${prefix}:*`,
  ]);

  if (result.exitCode !== 0 || !result.stdout) return;

  const images = result.stdout
    .split('\n')
    .map((line) => {
      const [name, ...dateParts] = line.split(' ');
      return { name, date: dateParts.join(' ') };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Remove old images beyond keepCount
  const toRemove = images.slice(keepCount);
  for (const img of toRemove) {
    await removeImage(img.name);
  }
}
