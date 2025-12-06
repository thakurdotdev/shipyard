# Requirements Document

## Introduction

The Mini Vercel Platform is a deployment platform that enables developers to deploy Next.js SSR applications and Vite React static applications from GitHub repositories. The system provides build orchestration, artifact management, deployment activation with rollback capabilities, domain management, and environment variable handling. The platform consists of four main components: a Next.js UI, a Control API service, a Build Worker service, and a Deploy Engine service.

## Glossary

- **UI**: The Next.js 16 frontend application using App Router that provides the user interface
- **Control API**: The Bun-based service using Elysia framework that manages projects, builds, environment variables, and orchestrates deployments
- **Build Worker**: The Bun-based service that clones repositories, installs dependencies, executes build commands, and uploads artifacts
- **Deploy Engine**: The Bun-based service that receives artifacts, manages deployments, and serves applications
- **Project**: A configured application with associated repository, build settings, and domain
- **Build**: A single execution of the build process for a project, resulting in an artifact
- **Artifact**: The compiled output from a build process, stored for deployment
- **Deployment**: An activated build artifact that is serving traffic at a URL
- **Preview Deployment**: A deployment accessible at a unique URL for testing before activation
- **Active Build**: The currently deployed build serving production traffic
- **Rollback**: The process of activating a previous build as the active deployment

## Requirements

### Requirement 1

**User Story:** As a developer, I want to create and configure projects, so that I can prepare applications for deployment.

#### Acceptance Criteria

1. WHEN a user creates a new project, THE Control API SHALL store the project configuration in Postgres
2. WHEN a user configures a GitHub repository URL, THE Control API SHALL validate and store the repository information
3. WHEN a user specifies a build command, THE Control API SHALL store the command for use during builds
4. WHEN a user assigns a domain to a project, THE Control API SHALL store the domain mapping
5. THE UI SHALL display all configured projects with their current status

### Requirement 2

**User Story:** As a developer, I want to manage environment variables for my projects, so that I can configure application behavior across deployments.

#### Acceptance Criteria

1. WHEN a user adds an environment variable, THE Control API SHALL store the key-value pair associated with the project
2. WHEN a user updates an environment variable, THE Control API SHALL modify the stored value
3. WHEN a user deletes an environment variable, THE Control API SHALL remove the key-value pair from storage
4. WHEN a build is triggered, THE Build Worker SHALL receive all environment variables for the project
5. THE UI SHALL display all environment variables for a project with masked values for sensitive data

### Requirement 3

**User Story:** As a developer, I want to trigger builds from GitHub repositories, so that I can create deployable artifacts from my code.

#### Acceptance Criteria

1. WHEN a user triggers a build, THE Control API SHALL create a build record and send a job to the Build Worker
2. WHEN the Build Worker receives a job, THE Build Worker SHALL clone the specified GitHub repository
3. WHEN the repository is cloned, THE Build Worker SHALL install dependencies using the appropriate package manager
4. WHEN dependencies are installed, THE Build Worker SHALL execute the configured build command
5. WHEN the build command completes successfully, THE Build Worker SHALL create an artifact from the build output

### Requirement 4

**User Story:** As a developer, I want to see build logs in real-time, so that I can monitor build progress and diagnose issues.

#### Acceptance Criteria

1. WHEN the Build Worker executes build steps, THE Build Worker SHALL stream log output to the Control API
2. WHEN the Control API receives log data, THE Control API SHALL forward the logs to connected UI clients via WebSocket
3. WHEN the UI connects to a build session, THE UI SHALL display logs as they arrive in real-time
4. WHEN a build completes, THE Control API SHALL persist the complete log output
5. THE UI SHALL allow users to view historical logs for completed builds

### Requirement 5

**User Story:** As a developer, I want to store build artifacts, so that I can deploy them to the Deploy Engine.

#### Acceptance Criteria

1. WHEN the Build Worker completes a build, THE Build Worker SHALL upload the artifact to the Deploy Engine
2. WHEN the Deploy Engine receives an artifact, THE Deploy Engine SHALL store the artifact with a unique identifier
3. WHEN an artifact is stored, THE Deploy Engine SHALL associate it with the corresponding build record
4. THE Control API SHALL track the storage location of each artifact
5. THE Deploy Engine SHALL retain artifacts for all builds to enable rollback functionality

### Requirement 6

**User Story:** As a developer, I want to activate builds as deployments, so that I can make specific versions of my application live.

#### Acceptance Criteria

1. WHEN a user activates a build, THE Control API SHALL send a deployment command to the Deploy Engine
2. WHEN the Deploy Engine receives a deployment command, THE Deploy Engine SHALL extract the build artifact
3. WHEN the artifact is extracted, THE Deploy Engine SHALL update the symlink to point to the new build
4. WHEN the symlink is updated, THE Deploy Engine SHALL restart the project process
5. WHEN the process restarts, THE Deploy Engine SHALL perform health checks before marking the deployment as active

### Requirement 7

**User Story:** As a developer, I want to rollback to previous builds, so that I can quickly recover from problematic deployments.

#### Acceptance Criteria

1. WHEN a user selects a previous build for activation, THE Control API SHALL treat it as a standard deployment
2. WHEN a rollback is triggered, THE Deploy Engine SHALL activate the selected previous build artifact
3. WHEN the rollback completes, THE Deploy Engine SHALL serve traffic from the rolled-back version
4. THE UI SHALL display the currently active build with visual indication of rollback status
5. THE Control API SHALL maintain a history of all deployment activations including rollbacks

### Requirement 8

**User Story:** As a developer, I want to access preview deployments, so that I can test builds before activating them as production.

#### Acceptance Criteria

1. WHEN a build completes, THE Deploy Engine SHALL make the build available at a unique preview URL
2. WHEN a user accesses a preview URL, THE Deploy Engine SHALL serve the application from the preview build
3. THE preview URL SHALL remain accessible until the build is deleted
4. THE UI SHALL display the preview URL for each completed build
5. THE Deploy Engine SHALL isolate preview deployments from active production deployments

### Requirement 9

**User Story:** As a developer, I want my applications served at stable project domains, so that users can access them reliably.

#### Acceptance Criteria

1. WHEN a project has an assigned domain, THE Deploy Engine SHALL serve the active build at that domain
2. WHEN the active build changes, THE Deploy Engine SHALL serve the new build at the same domain without URL changes
3. WHEN a request arrives at a project domain, THE Deploy Engine SHALL route it to the active deployment
4. THE Deploy Engine SHALL support both static serving for Vite builds and SSR for Next.js builds
5. THE Deploy Engine SHALL return appropriate HTTP status codes for health check requests

### Requirement 10

**User Story:** As a developer, I want the UI to communicate with the Control API, so that I can manage my projects and deployments.

#### Acceptance Criteria

1. WHEN the UI needs to fetch data, THE UI SHALL send REST requests to the Control API
2. WHEN the UI needs real-time updates, THE UI SHALL establish WebSocket connections to the Control API
3. WHEN the Control API receives REST requests, THE Control API SHALL authenticate and process the requests
4. WHEN the Control API has updates for connected clients, THE Control API SHALL push data via WebSocket
5. THE UI SHALL handle connection failures gracefully and attempt reconnection

### Requirement 11

**User Story:** As a system administrator, I want the services to handle errors gracefully, so that the platform remains stable and provides useful feedback.

#### Acceptance Criteria

1. WHEN a GitHub repository clone fails, THE Build Worker SHALL report the error to the Control API with details
2. WHEN a build command fails, THE Build Worker SHALL capture the error output and mark the build as failed
3. WHEN artifact upload fails, THE Build Worker SHALL retry the upload with exponential backoff
4. WHEN deployment activation fails, THE Deploy Engine SHALL maintain the previous active deployment
5. WHEN health checks fail after deployment, THE Deploy Engine SHALL mark the deployment as unhealthy and alert the Control API

### Requirement 12

**User Story:** As a developer, I want to distinguish between Next.js SSR and Vite static applications, so that they are deployed with appropriate serving strategies.

#### Acceptance Criteria

1. WHEN a project is configured, THE Control API SHALL store the application type (Next.js SSR or Vite static)
2. WHEN the Deploy Engine activates a Vite build, THE Deploy Engine SHALL serve files as static assets
3. WHEN the Deploy Engine activates a Next.js build, THE Deploy Engine SHALL start a Node.js process for SSR
4. WHEN serving a static Vite application, THE Deploy Engine SHALL handle routing for single-page applications
5. WHEN serving a Next.js application, THE Deploy Engine SHALL proxy requests to the Next.js server process
