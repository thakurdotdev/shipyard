# Design Document

## Overview

The Mini Vercel Platform is a multi-service deployment system built with modern JavaScript/TypeScript tooling. The architecture consists of four independent services that communicate via REST APIs and WebSockets:

1. **UI** - Next.js 16 frontend with App Router
2. **Control API** - Bun + Elysia orchestration service with Postgres
3. **Build Worker** - Bun + Elysia build execution service
4. **Deploy Engine** - Bun + Elysia application runtime service

The system follows a job queue pattern where the Control API orchestrates work, the Build Worker executes builds, and the Deploy Engine manages running applications. Real-time communication is achieved through WebSocket connections for log streaming and status updates.

## Architecture

### System Diagram

```
┌─────────────────┐
│   UI (Next.js)  │
│   Port: 3000    │
└────────┬────────┘
         │ REST + WebSocket
         ▼
┌─────────────────────────┐
│   Control API (Bun)     │
│   Port: 4000            │
│   - Postgres (Drizzle)  │
│   - Job Queue           │
└───┬─────────────────┬───┘
    │                 │
    │ REST            │ REST
    ▼                 ▼
┌──────────────┐  ┌──────────────┐
│ Build Worker │  │Deploy Engine │
│ Port: 4001   │  │ Port: 4002   │
└──────────────┘  └──────────────┘
```

### Service Responsibilities

**UI Service:**

- Renders project management interface
- Displays build history and logs
- Manages WebSocket connections for real-time updates
- Provides deployment controls (activate, rollback)
- No backend logic - pure client-side application

**Control API Service:**

- Stores projects, builds, environment variables in Postgres
- Manages job queue for build requests
- Coordinates between Build Worker and Deploy Engine
- Streams logs from Build Worker to UI clients
- Handles authentication and authorization
- Tracks deployment state and history

**Build Worker Service:**

- Accepts build jobs from Control API
- Clones GitHub repositories
- Installs dependencies (npm/yarn/pnpm detection)
- Executes build commands
- Streams logs back to Control API
- Uploads artifacts to Deploy Engine
- Reports build status (success/failure)

**Deploy Engine Service:**

- Receives and stores build artifacts
- Manages deployment symlinks
- Runs application processes (Next.js SSR or static file serving)
- Performs health checks
- Serves applications at project domains
- Handles preview deployments

## Components and Interfaces

### UI Components

**Pages:**

- `/` - Dashboard with project list
- `/projects/[id]` - Project detail with builds and deployments
- `/projects/[id]/builds/[buildId]` - Build detail with live logs
- `/projects/[id]/settings` - Project configuration and environment variables

**Key React Components:**

- `ProjectList` - Displays all projects with status
- `BuildHistory` - Shows build timeline with activation status
- `LogViewer` - Real-time log streaming with WebSocket
- `EnvironmentVariables` - CRUD interface for env vars
- `DeploymentControls` - Activate/rollback buttons

**API Client:**

```typescript
// Functional API client
export async function getProjects(): Promise<Project[]>;
export async function createProject(data: CreateProjectInput): Promise<Project>;
export async function triggerBuild(project_id: string): Promise<Build>;
export async function activateBuild(
  project_id: string,
  build_id: string,
): Promise<Deployment>;
export function connectLogStream(build_id: string): WebSocket;
```

### Control API Components

**Database Schema (Drizzle):**

```typescript
// projects table
{
  id: uuid (primary key)
  name: string
  github_url: string
  build_command: string
  app_type: 'nextjs' | 'vite'
  domain: string
  created_at: timestamp
  updated_at: timestamp
}

// builds table
{
  id: uuid (primary key)
  project_id: uuid (foreign key)
  status: 'pending' | 'building' | 'success' | 'failed'
  logs: text
  artifact_id: string (nullable)
  created_at: timestamp
  completed_at: timestamp (nullable)
}

// deployments table
{
  id: uuid (primary key)
  project_id: uuid (foreign key)
  build_id: uuid (foreign key)
  status: 'active' | 'inactive'
  activated_at: timestamp
}

// environment_variables table
{
  id: uuid (primary key)
  project_id: uuid (foreign key)
  key: string
  value: string (encrypted)
  created_at: timestamp
  updated_at: timestamp
}
```

**REST API Endpoints:**

```
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PUT    /api/projects/:id
DELETE /api/projects/:id

GET    /api/projects/:id/builds
POST   /api/projects/:id/builds
GET    /api/builds/:id
GET    /api/builds/:id/logs

POST   /api/projects/:id/deployments
GET    /api/projects/:id/deployments
POST   /api/deployments/:id/activate

GET    /api/projects/:id/env
POST   /api/projects/:id/env
PUT    /api/projects/:id/env/:key
DELETE /api/projects/:id/env/:key
```

**WebSocket Events:**

```typescript
// Client -> Server
{ type: 'subscribe_build', build_id: string }
{ type: 'unsubscribe_build', build_id: string }

// Server -> Client
{ type: 'build_log', build_id: string, data: string }
{ type: 'build_status', build_id: string, status: string }
{ type: 'deployment_status', deployment_id: string, status: string }
```

**Job Queue Interface:**

```typescript
interface BuildJob {
  build_id: string;
  project_id: string;
  github_url: string;
  build_command: string;
  app_type: "nextjs" | "vite";
  env_vars: Record<string, string>;
}

// Functional job queue operations
export async function enqueueJob(job: BuildJob): Promise<void>;
export async function sendJobToWorker(job: BuildJob): Promise<void>;
```

### Build Worker Components

**Build Executor:**

```typescript
// Functional build operations
export async function cloneRepository(
  url: string,
  work_dir: string,
): Promise<void>;
export async function installDependencies(work_dir: string): Promise<void>;
export async function runBuildCommand(
  command: string,
  work_dir: string,
  env_vars: Record<string, string>,
): Promise<void>;
export async function createArtifact(
  work_dir: string,
  app_type: string,
): Promise<string>;
export async function uploadArtifact(
  artifact_path: string,
  build_id: string,
): Promise<string>;
```

**Log Streamer:**

```typescript
// Functional log streaming operations
export async function streamLogToControlAPI(
  build_id: string,
  log_data: string,
): Promise<void>;
export async function finalizeLog(build_id: string): Promise<void>;
```

**REST API Endpoints:**

```
POST   /api/build/execute
```

### Deploy Engine Components

**Artifact Manager:**

```typescript
// Functional artifact operations
export async function receiveArtifact(
  build_id: string,
  artifact_stream: ReadableStream,
): Promise<string>;
export async function extractArtifact(
  artifact_id: string,
  target_dir: string,
): Promise<void>;
export async function getArtifactPath(artifact_id: string): Promise<string>;
```

**Deployment Manager:**

```typescript
// Functional deployment operations
export async function activateDeployment(
  project_id: string,
  build_id: string,
): Promise<void>;
export async function updateSymlink(
  project_id: string,
  build_path: string,
): Promise<void>;
export async function restartProcess(
  project_id: string,
  app_type: string,
): Promise<void>;
export async function healthCheck(project_id: string): Promise<boolean>;
```

**Application Server:**

```typescript
// Functional serving operations
export async function serveStatic(
  project_id: string,
  request: Request,
): Promise<Response>;
export async function proxyToNextJS(
  project_id: string,
  request: Request,
): Promise<Response>;
export async function servePreview(
  build_id: string,
  request: Request,
): Promise<Response>;
```

**REST API Endpoints:**

```
POST   /api/artifacts/upload
GET    /api/artifacts/:id
POST   /api/deployments/activate
GET    /api/health/:projectId
```

**Application Serving:**

```
GET    /:domain/*  (production serving)
GET    /preview/:buildId/*  (preview serving)
```

## Data Models

### Project

```typescript
interface Project {
  id: string;
  name: string;
  github_url: string;
  build_command: string;
  app_type: "nextjs" | "vite";
  domain: string;
  created_at: Date;
  updated_at: Date;
}
```

### Build

```typescript
interface Build {
  id: string;
  project_id: string;
  status: "pending" | "building" | "success" | "failed";
  logs: string;
  artifact_id: string | null;
  created_at: Date;
  completed_at: Date | null;
}
```

### Deployment

```typescript
interface Deployment {
  id: string;
  project_id: string;
  build_id: string;
  status: "active" | "inactive";
  activated_at: Date;
}
```

### EnvironmentVariable

```typescript
interface EnvironmentVariable {
  id: string;
  project_id: string;
  key: string;
  value: string; // encrypted at rest
  created_at: Date;
  updated_at: Date;
}
```

### BuildJob

```typescript
interface BuildJob {
  build_id: string;
  project_id: string;
  github_url: string;
  build_command: string;
  app_type: "nextjs" | "vite";
  env_vars: Record<string, string>;
}
```

### Artifact

```typescript
interface Artifact {
  id: string;
  build_id: string;
  storage_path: string;
  size: number;
  created_at: Date;
}
```

## Correctness Properties

_A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees._

### Project Management Properties

**Property 1: Project data persistence**
_For any_ valid project configuration (including name, GitHub URL, build command, app type, and domain), creating the project should result in all configuration data being retrievable from the database with identical values.
**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

**Property 2: Project listing completeness**
_For any_ set of projects in the database, the UI should display all projects with their current status information.
**Validates: Requirements 1.5**

### Environment Variable Properties

**Property 3: Environment variable CRUD operations**
_For any_ project and environment variable key-value pair, the system should support adding (creating new entry), updating (modifying existing value), and deleting (removing entry) operations, with each operation correctly reflected in subsequent queries.
**Validates: Requirements 2.1, 2.2, 2.3**

**Property 4: Environment variable propagation**
_For any_ project with environment variables, triggering a build should result in the Build Worker receiving all environment variables associated with that project.
**Validates: Requirements 2.4**

**Property 5: Environment variable display with masking**
_For any_ project with environment variables, the UI should display all variable keys and mask all variable values.
**Validates: Requirements 2.5**

### Build Execution Properties

**Property 6: Build initiation creates records and jobs**
_For any_ project, triggering a build should result in both a build record being created in the database and a job being sent to the Build Worker.
**Validates: Requirements 3.1**

**Property 7: Build pipeline execution order**
_For any_ build job, the Build Worker should execute steps in the correct order: clone repository, install dependencies, execute build command, create artifact. Each step should complete before the next begins.
**Validates: Requirements 3.2, 3.3, 3.4, 3.5**

**Property 8: Successful builds produce artifacts**
_For any_ build that completes successfully, an artifact should be created and uploaded to the Deploy Engine.
**Validates: Requirements 3.5, 5.1**

### Log Streaming Properties

**Property 9: Log streaming pipeline**
_For any_ build execution, log output should flow from Build Worker to Control API to UI clients via WebSocket in real-time.
**Validates: Requirements 4.1, 4.2, 4.3**

**Property 10: Log persistence on completion**
_For any_ completed build, all log output should be persisted in the database and retrievable for historical viewing.
**Validates: Requirements 4.4, 4.5**

### Artifact Management Properties

**Property 11: Artifact lifecycle management**
_For any_ successful build, the artifact should be uploaded to Deploy Engine, stored with a unique identifier, associated with the build record, tracked by Control API, and retained indefinitely for rollback capability.
**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

### Deployment Properties

**Property 12: Deployment activation pipeline**
_For any_ build activation request, the system should execute the deployment pipeline: send command to Deploy Engine, extract artifact, update symlink, restart process, perform health checks, and only mark as active after successful health checks.
**Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

**Property 13: Rollback equivalence to deployment**
_For any_ previous build, activating it as a rollback should execute the same deployment pipeline as activating a new build, resulting in traffic being served from the selected build.
**Validates: Requirements 7.1, 7.2, 7.3**

**Property 14: Deployment history tracking**
_For any_ sequence of deployment activations and rollbacks, the Control API should maintain a complete history with timestamps and build identifiers.
**Validates: Requirements 7.5**

**Property 15: Active build display**
_For any_ project state, the UI should display the currently active build with correct indication of whether it represents a rollback.
**Validates: Requirements 7.4**

### Preview Deployment Properties

**Property 16: Preview URL generation and accessibility**
_For any_ completed build, a unique preview URL should be generated and remain accessible until the build is deleted.
**Validates: Requirements 8.1, 8.3**

**Property 17: Preview serving correctness**
_For any_ preview URL request, the Deploy Engine should serve the application from the specific preview build, not from the active production deployment.
**Validates: Requirements 8.2, 8.5**

**Property 18: Preview URL display**
_For any_ completed build, the UI should display the preview URL.
**Validates: Requirements 8.4**

### Domain Serving Properties

**Property 19: Domain routing to active deployment**
_For any_ project with an assigned domain, requests to that domain should be routed to the currently active deployment, regardless of which build is active.
**Validates: Requirements 9.1, 9.3**

**Property 20: Seamless deployment updates**
_For any_ project domain, changing the active build should result in subsequent requests being served from the new build without any change to the domain URL.
**Validates: Requirements 9.2**

**Property 21: Application type serving strategy**
_For any_ deployment, Vite builds should be served as static files with SPA routing support, while Next.js builds should be served via Node.js process with request proxying.
**Validates: Requirements 9.4, 12.2, 12.3, 12.4, 12.5**

**Property 22: Health check responses**
_For any_ health check request to a project, the Deploy Engine should return appropriate HTTP status codes indicating deployment health.
**Validates: Requirements 9.5**

### Communication Properties

**Property 23: UI communication protocol selection**
_For any_ UI operation, data fetching should use REST requests while real-time updates should use WebSocket connections to the Control API.
**Validates: Requirements 10.1, 10.2**

**Property 24: Control API request processing**
_For any_ REST request received by the Control API, the request should be authenticated and processed.
**Validates: Requirements 10.3**

**Property 25: WebSocket push notifications**
_For any_ state change that affects connected UI clients, the Control API should push updates via WebSocket.
**Validates: Requirements 10.4**

**Property 26: Connection resilience**
_For any_ connection failure between UI and Control API, the UI should attempt reconnection with appropriate backoff strategy.
**Validates: Requirements 10.5**

### Error Handling Properties

**Property 27: Build error reporting**
_For any_ build failure (clone failure, dependency installation failure, or build command failure), the Build Worker should report the error to Control API with details and mark the build as failed.
**Validates: Requirements 11.1, 11.2**

**Property 28: Artifact upload retry with exponential backoff**
_For any_ artifact upload failure, the Build Worker should retry the upload with exponentially increasing delays between attempts.
**Validates: Requirements 11.3**

**Property 29: Deployment failure rollback**
_For any_ deployment activation that fails (including failed health checks), the Deploy Engine should maintain the previous active deployment and mark the new deployment as unhealthy.
**Validates: Requirements 11.4, 11.5**

### Application Type Properties

**Property 30: Application type persistence**
_For any_ project configuration, the application type (Next.js SSR or Vite static) should be stored and retrievable.
**Validates: Requirements 12.1**

## Error Handling

### Build Worker Error Handling

**Repository Clone Failures:**

- Catch Git clone errors (authentication, network, invalid URL)
- Report detailed error message to Control API
- Mark build as failed with error details in logs
- Do not proceed to dependency installation

**Dependency Installation Failures:**

- Catch package manager errors (missing dependencies, network issues)
- Capture full error output in logs
- Report failure to Control API
- Mark build as failed

**Build Command Failures:**

- Catch build process errors (compilation errors, missing files)
- Stream error output to logs
- Report failure to Control API
- Mark build as failed
- Clean up working directory

**Artifact Upload Failures:**

- Implement retry logic with exponential backoff (1s, 2s, 4s, 8s, 16s)
- Maximum 5 retry attempts
- If all retries fail, mark build as failed
- Report upload failure to Control API

### Deploy Engine Error Handling

**Artifact Extraction Failures:**

- Validate artifact integrity before extraction
- Catch extraction errors (corrupted archive, disk space)
- Report failure to Control API
- Do not proceed with deployment

**Symlink Update Failures:**

- Validate target directory exists
- Catch filesystem errors
- Maintain previous symlink on failure
- Report failure to Control API

**Process Start Failures:**

- Catch process spawn errors
- Validate port availability
- Report failure to Control API
- Maintain previous running process

**Health Check Failures:**

- Implement timeout for health checks (30 seconds)
- Retry health checks 3 times with 5-second intervals
- If all health checks fail, mark deployment as unhealthy
- Maintain previous active deployment
- Alert Control API of unhealthy deployment

### Control API Error Handling

**Database Connection Failures:**

- Implement connection pooling with retry logic
- Return 503 Service Unavailable to clients
- Log connection errors
- Attempt reconnection with exponential backoff

**WebSocket Connection Failures:**

- Handle client disconnections gracefully
- Clean up subscriptions on disconnect
- Support automatic reconnection from client
- Buffer messages during brief disconnections

**Build Worker Communication Failures:**

- Implement timeout for build job requests (5 minutes)
- Mark builds as failed if worker doesn't respond
- Retry job submission once before failing
- Log communication errors

**Deploy Engine Communication Failures:**

- Implement timeout for deployment requests (2 minutes)
- Maintain previous deployment state on failure
- Retry deployment command once before failing
- Log communication errors

### UI Error Handling

**API Request Failures:**

- Display user-friendly error messages
- Implement retry logic for transient failures
- Show loading states during retries
- Log errors for debugging

**WebSocket Connection Failures:**

- Display connection status indicator
- Attempt automatic reconnection with exponential backoff
- Show offline mode when disconnected
- Queue actions for retry when reconnected

**Invalid User Input:**

- Validate form inputs before submission
- Display inline validation errors
- Prevent submission of invalid data
- Provide helpful error messages

## Testing Strategy

### Unit Testing

The system will use **Vitest** as the testing framework for all services (UI, Control API, Build Worker, Deploy Engine). Unit tests will focus on:

**Control API Unit Tests:**

- Database operations (CRUD for projects, builds, deployments, env vars)
- API endpoint handlers
- WebSocket event handlers
- Job queue operations
- Authentication and authorization logic

**Build Worker Unit Tests:**

- Build executor methods (clone, install, build, artifact creation)
- Log streaming functionality
- Error handling for each build step
- Artifact upload logic

**Deploy Engine Unit Tests:**

- Artifact management (receive, extract, storage)
- Deployment manager (symlink updates, process management)
- Health check logic
- Static file serving
- Next.js proxy logic

**UI Unit Tests:**

- React component rendering
- API client methods
- WebSocket connection handling
- Form validation
- State management

### Property-Based Testing

The system will use **fast-check** for property-based testing in TypeScript/JavaScript. Each correctness property from the design document will be implemented as a property-based test.

**Configuration:**

- Minimum 100 iterations per property test
- Each test must reference the design document property using the format: `**Feature: mini-vercel-platform, Property {number}: {property_text}**`
- Tests should use smart generators that constrain inputs to valid ranges

**Property Test Coverage:**

- All 30 correctness properties must have corresponding property-based tests
- Tests should generate random valid inputs (projects, builds, env vars, etc.)
- Tests should verify invariants hold across all generated inputs
- Tests should avoid mocking when possible to test real behavior

**Example Property Test Structure:**

```typescript
import fc from "fast-check";

// **Feature: mini-vercel-platform, Property 1: Project data persistence**
test("project data persistence", () => {
  fc.assert(
    fc.property(projectConfigGenerator(), async (project_config) => {
      const created = await createProject(project_config);
      const retrieved = await getProject(created.id);
      expect(retrieved).toEqual(created);
    }),
    { numRuns: 100 },
  );
});
```

### Integration Testing

Integration tests will verify interactions between services:

**Control API + Database:**

- End-to-end API request handling with real database
- WebSocket message flow
- Transaction handling

**Control API + Build Worker:**

- Job submission and execution
- Log streaming pipeline
- Build status updates

**Control API + Deploy Engine:**

- Deployment activation flow
- Artifact management
- Health check reporting

**Full System Integration:**

- Complete build and deployment pipeline
- Rollback scenarios
- Preview deployment access
- Domain serving

### End-to-End Testing

E2E tests will use **Playwright** to test the complete user workflow through the UI:

- Create project and configure settings
- Add environment variables
- Trigger build and watch logs
- Activate deployment
- Access deployed application
- Perform rollback
- Access preview deployment

## Technology Stack

### UI Service

- **Framework:** Next.js 16 with App Router
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **State Management:** React hooks + Context API
- **HTTP Client:** fetch API
- **WebSocket Client:** native WebSocket API
- **Testing:** Vitest + React Testing Library + Playwright

### Control API Service

- **Runtime:** Bun
- **Framework:** Elysia
- **Language:** TypeScript
- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **WebSocket:** Elysia WebSocket plugin
- **Testing:** Vitest + fast-check

### Build Worker Service

- **Runtime:** Bun
- **Framework:** Elysia
- **Language:** TypeScript
- **Git Operations:** simple-git library
- **Process Execution:** Bun.spawn
- **Testing:** Vitest + fast-check

### Deploy Engine Service

- **Runtime:** Bun
- **Framework:** Elysia
- **Language:** TypeScript
- **Process Management:** Bun.spawn
- **File System:** Node.js fs/promises
- **Static Serving:** Elysia static plugin
- **Testing:** Vitest + fast-check

### Infrastructure

- **Database:** PostgreSQL 15+
- **Storage:** Local filesystem (artifacts and deployments)
- **Process Management:** Direct process spawning (no PM2/systemd for simplicity)

## Deployment Architecture

### Directory Structure

```
/var/mini-vercel/
├── artifacts/
│   └── {build_id}/
│       └── artifact.tar.gz
├── deployments/
│   └── {project_id}/
│       ├── builds/
│       │   ├── {build_id_1}/
│       │   ├── {build_id_2}/
│       │   └── {build_id_3}/
│       └── current -> builds/{build_id_2}  (symlink)
└── workspaces/
    └── {build_id}/  (temporary build workspace)
```

### Port Allocation

- UI: 3000
- Control API: 4000
- Build Worker: 4001
- Deploy Engine: 4002
- Next.js Apps: 5000-5999 (dynamically assigned)

### Process Management

Each deployed Next.js application runs as a separate Bun process:

- Process spawned with `bun run start` in deployment directory
- Process ID tracked in memory by Deploy Engine
- Health checks via HTTP requests to app port
- Graceful shutdown on deployment updates

### Symlink Strategy

The Deploy Engine uses symlinks for zero-downtime deployments:

1. Extract new build to `deployments/{project_id}/builds/{build_id}`
2. Update symlink `deployments/{project_id}/current` to point to new build
3. Restart process to use new build
4. Old builds remain available for rollback

## Security Considerations

### Environment Variables

- Encrypt environment variable values at rest in database
- Use AES-256-GCM encryption
- Store encryption key in environment variable (not in database)
- Mask values in UI display

### GitHub Access

- Support GitHub personal access tokens for private repositories
- Store tokens encrypted in database
- Pass tokens to Build Worker securely via HTTPS

### API Authentication

- Implement JWT-based authentication for Control API
- Require authentication for all API endpoints
- Use HTTP-only cookies for token storage in UI

### Process Isolation

- Each deployed application runs as separate process
- No shared state between applications
- Filesystem isolation via separate directories

### Input Validation

- Validate all user inputs (project names, URLs, commands)
- Sanitize build commands to prevent command injection
- Validate domain names against allowed patterns
- Limit build command execution time (30 minute timeout)

## Performance Considerations

### Build Concurrency

- Build Worker processes one build at a time initially
- Can be scaled to multiple workers for parallel builds
- Queue builds in Control API when worker is busy

### Database Optimization

- Index on project_id, build_id for fast lookups
- Index on deployment status for active deployment queries
- Connection pooling for database connections

### Log Storage

- Store logs as text in database initially
- Consider moving to object storage for large logs
- Implement log rotation for very large builds

### Artifact Storage

- Store artifacts on local filesystem initially
- Implement cleanup policy for old artifacts (optional)
- Consider moving to object storage for production

### Caching

- Cache active deployment information in Deploy Engine memory
- Cache project configuration in Control API memory
- Invalidate caches on updates

## Future Enhancements

These features are out of scope for the initial implementation but could be added later:

- Multiple build workers for parallel builds
- Custom domains with SSL certificate management
- Build caching for faster rebuilds
- Automatic deployments on Git push (webhooks)
- Deployment analytics and metrics
- Resource limits per project (CPU, memory)
- Multi-region deployments
- Database backups and disaster recovery
- User authentication and multi-tenancy
- Build artifacts stored in S3-compatible storage
- Container-based deployments (Docker)
