# Implementation Plan

- [ ] 1. Set up project structure and dependencies

  - Create monorepo structure with four services (ui, control-api, build-worker, deploy-engine)
  - Initialize each service with Bun and TypeScript
  - Set up shared types package for common interfaces
  - Configure Vitest for testing across all services
  - Install fast-check for property-based testing
  - _Requirements: All_

- [ ] 2. Set up database and schema

  - [ ] 2.1 Initialize PostgreSQL database

    - Set up Postgres connection configuration
    - Create database initialization script
    - _Requirements: 1.1_

  - [ ] 2.2 Define Drizzle schema

    - Create projects table schema with snake_case fields
    - Create builds table schema with snake_case fields
    - Create deployments table schema with snake_case fields
    - Create environment_variables table schema with snake_case fields
    - Add indexes for project_id, build_id, and deployment status
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 3.1, 6.1, 12.1_

  - [ ] 2.3 Create database migration system

    - Set up Drizzle migration configuration
    - Create initial migration
    - _Requirements: 1.1_

  - [ ]\* 2.4 Write property test for database schema
    - **Property 1: Project data persistence**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

- [ ] 3. Implement Control API core functionality

  - [ ] 3.1 Set up Elysia server with routes

    - Initialize Elysia application
    - Configure CORS and middleware
    - Set up route structure for projects, builds, deployments, env vars
    - _Requirements: 10.3_

  - [ ] 3.2 Implement project CRUD operations

    - Create getProjects function
    - Create createProject function with validation
    - Create getProject function
    - Create updateProject function
    - Create deleteProject function
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]\* 3.3 Write property test for project CRUD

    - **Property 1: Project data persistence**
    - **Property 3: Environment variable CRUD operations**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3**

  - [ ] 3.4 Implement environment variable operations

    - Create addEnvironmentVariable function with encryption
    - Create updateEnvironmentVariable function
    - Create deleteEnvironmentVariable function
    - Create getEnvironmentVariables function with decryption
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.5 Implement build management

    - Create triggerBuild function that creates build record
    - Create getBuild function
    - Create getBuilds function for project
    - Create updateBuildStatus function
    - _Requirements: 3.1_

  - [ ]\* 3.6 Write property test for build initiation
    - **Property 6: Build initiation creates records and jobs**
    - **Validates: Requirements 3.1**

- [ ] 4. Implement WebSocket log streaming in Control API

  - [ ] 4.1 Set up WebSocket server

    - Configure Elysia WebSocket plugin
    - Implement subscribe_build and unsubscribe_build handlers
    - Maintain map of build_id to connected clients
    - _Requirements: 4.2, 10.2_

  - [ ] 4.2 Implement log forwarding

    - Create receiveBuildLog function to accept logs from Build Worker
    - Create forwardLogToClients function to push logs via WebSocket
    - Create persistBuildLog function to store complete logs
    - _Requirements: 4.2, 4.4_

  - [ ]\* 4.3 Write property test for log streaming
    - **Property 9: Log streaming pipeline**
    - **Property 10: Log persistence on completion**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

- [ ] 5. Implement job queue in Control API

  - [ ] 5.1 Create job queue system

    - Implement enqueueJob function
    - Implement sendJobToWorker function that makes HTTP request to Build Worker
    - Add error handling for worker communication failures
    - _Requirements: 3.1_

  - [ ]\* 5.2 Write property test for job queue
    - **Property 6: Build initiation creates records and jobs**
    - **Validates: Requirements 3.1**

- [ ] 6. Implement Build Worker core functionality

  - [ ] 6.1 Set up Elysia server

    - Initialize Elysia application
    - Create /api/build/execute endpoint
    - _Requirements: 3.1_

  - [ ] 6.2 Implement repository cloning

    - Create cloneRepository function using simple-git
    - Add error handling for clone failures
    - Create workspace directory management
    - _Requirements: 3.2, 11.1_

  - [ ] 6.3 Implement dependency installation

    - Create detectPackageManager function (npm/yarn/pnpm)
    - Create installDependencies function
    - Add error handling for installation failures
    - _Requirements: 3.3, 11.2_

  - [ ] 6.4 Implement build command execution

    - Create runBuildCommand function using Bun.spawn
    - Pass environment variables to build process
    - Capture stdout and stderr
    - Add error handling for build failures
    - _Requirements: 3.4, 11.2_

  - [ ]\* 6.5 Write property test for build pipeline
    - **Property 7: Build pipeline execution order**
    - **Property 4: Environment variable propagation**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 2.4**

- [ ] 7. Implement log streaming from Build Worker

  - [ ] 7.1 Create log streaming functions

    - Implement streamLogToControlAPI function
    - Stream logs during clone, install, and build steps
    - Implement finalizeLog function
    - _Requirements: 4.1_

  - [ ]\* 7.2 Write property test for log streaming
    - **Property 9: Log streaming pipeline**
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [ ] 8. Implement artifact creation and upload in Build Worker

  - [ ] 8.1 Create artifact from build output

    - Create createArtifact function that detects app type
    - For Next.js: tar .next directory and package.json
    - For Vite: tar dist directory
    - _Requirements: 3.5_

  - [ ] 8.2 Implement artifact upload

    - Create uploadArtifact function
    - Make HTTP POST request to Deploy Engine with artifact stream
    - Implement retry logic with exponential backoff
    - _Requirements: 5.1, 11.3_

  - [ ]\* 8.3 Write property test for artifact creation
    - **Property 8: Successful builds produce artifacts**
    - **Property 28: Artifact upload retry with exponential backoff**
    - **Validates: Requirements 3.5, 5.1, 11.3**

- [ ] 9. Implement Deploy Engine artifact management

  - [ ] 9.1 Set up Elysia server

    - Initialize Elysia application
    - Create /api/artifacts/upload endpoint
    - Create /api/deployments/activate endpoint
    - _Requirements: 5.2_

  - [ ] 9.2 Implement artifact storage

    - Create receiveArtifact function to handle upload stream
    - Store artifact in /var/mini-vercel/artifacts/{build_id}/
    - Generate unique artifact ID
    - Create getArtifactPath function
    - _Requirements: 5.2, 5.3_

  - [ ] 9.3 Implement artifact extraction

    - Create extractArtifact function
    - Extract to /var/mini-vercel/deployments/{project_id}/builds/{build_id}/
    - Validate artifact integrity
    - Add error handling for extraction failures
    - _Requirements: 6.2, 11.4_

  - [ ]\* 9.4 Write property test for artifact lifecycle
    - **Property 11: Artifact lifecycle management**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

- [ ] 10. Implement deployment activation in Deploy Engine

  - [ ] 10.1 Create deployment functions

    - Implement activateDeployment function
    - Implement updateSymlink function to point current to new build
    - Add error handling for symlink failures
    - _Requirements: 6.1, 6.3, 11.4_

  - [ ] 10.2 Implement process management

    - Create restartProcess function
    - For Next.js: spawn Bun process with `bun run start`
    - For Vite: no process needed (static files)
    - Track process IDs in memory
    - Gracefully shutdown old processes
    - _Requirements: 6.4, 12.3_

  - [ ] 10.3 Implement health checks

    - Create healthCheck function
    - Make HTTP request to app port
    - Retry 3 times with 5-second intervals
    - Mark deployment as active only after successful health check
    - Mark as unhealthy and maintain previous deployment on failure
    - _Requirements: 6.5, 11.5_

  - [ ]\* 10.4 Write property test for deployment activation
    - **Property 12: Deployment activation pipeline**
    - **Property 29: Deployment failure rollback**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 11.4, 11.5**

- [ ] 11. Implement application serving in Deploy Engine

  - [ ] 11.1 Create serving functions

    - Implement serveStatic function for Vite apps
    - Handle SPA routing (fallback to index.html)
    - Implement proxyToNextJS function for Next.js apps
    - Route requests based on domain to active deployment
    - _Requirements: 9.1, 9.3, 9.4, 12.2, 12.4, 12.5_

  - [ ] 11.2 Implement preview deployments

    - Create servePreview function
    - Route /preview/{build_id}/\* to specific build
    - Ensure isolation from production deployments
    - _Requirements: 8.1, 8.2, 8.5_

  - [ ]\* 11.3 Write property test for serving
    - **Property 19: Domain routing to active deployment**
    - **Property 20: Seamless deployment updates**
    - **Property 21: Application type serving strategy**
    - **Property 17: Preview serving correctness**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 8.2, 8.5, 12.2, 12.3, 12.4, 12.5**

- [ ] 12. Implement rollback functionality

  - [ ] 12.1 Add rollback support in Control API

    - Modify activateBuild to work with any build (new or old)
    - Track deployment history with timestamps
    - _Requirements: 7.1, 7.5_

  - [ ] 12.2 Ensure Deploy Engine handles rollback

    - Verify activateDeployment works for previous builds
    - Ensure artifacts are retained for rollback
    - _Requirements: 7.2, 7.3, 5.5_

  - [ ]\* 12.3 Write property test for rollback
    - **Property 13: Rollback equivalence to deployment**
    - **Property 14: Deployment history tracking**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.5**

- [ ] 13. Implement UI with Next.js

  - [ ] 13.1 Set up Next.js 16 with App Router

    - Initialize Next.js project with TypeScript
    - Configure Tailwind CSS
    - Set up app directory structure
    - _Requirements: 10.1_

  - [ ] 13.2 Create API client functions

    - Implement getProjects function
    - Implement createProject function
    - Implement triggerBuild function
    - Implement activateBuild function
    - Implement connectLogStream WebSocket function
    - Add error handling and retry logic
    - _Requirements: 10.1, 10.2, 10.5_

  - [ ] 13.3 Build project management pages

    - Create dashboard page (/) with ProjectList component
    - Create project detail page (/projects/[id])
    - Create build detail page (/projects/[id]/builds/[build_id])
    - Create settings page (/projects/[id]/settings)
    - _Requirements: 1.5_

  - [ ] 13.4 Implement ProjectList component

    - Display all projects with status
    - Show active deployment info
    - Add create project button
    - _Requirements: 1.5_

  - [ ]\* 13.5 Write property test for project listing

    - **Property 2: Project listing completeness**
    - **Validates: Requirements 1.5**

  - [ ] 13.6 Implement BuildHistory component

    - Display builds with status
    - Show activation status
    - Add activate and rollback buttons
    - Display preview URLs
    - _Requirements: 7.4, 8.4_

  - [ ]\* 13.7 Write property test for build display

    - **Property 15: Active build display**
    - **Property 18: Preview URL display**
    - **Validates: Requirements 7.4, 8.4**

  - [ ] 13.8 Implement LogViewer component

    - Connect to WebSocket for real-time logs
    - Display logs as they arrive
    - Handle connection failures and reconnection
    - _Requirements: 4.3, 10.5_

  - [ ]\* 13.9 Write property test for log display

    - **Property 9: Log streaming pipeline**
    - **Validates: Requirements 4.3**

  - [ ] 13.10 Implement EnvironmentVariables component

    - Display env vars with masked values
    - Add create, update, delete functionality
    - _Requirements: 2.5_

  - [ ]\* 13.11 Write property test for env var display

    - **Property 5: Environment variable display with masking**
    - **Validates: Requirements 2.5**

  - [ ] 13.12 Implement DeploymentControls component
    - Add activate build button
    - Add rollback button
    - Show deployment status
    - _Requirements: 6.1, 7.1_

- [ ] 14. Implement error handling across services

  - [ ] 14.1 Add error handling in Build Worker

    - Handle clone failures with detailed error reporting
    - Handle dependency installation failures
    - Handle build command failures
    - Implement artifact upload retry with exponential backoff
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ]\* 14.2 Write property test for build error handling

    - **Property 27: Build error reporting**
    - **Property 28: Artifact upload retry with exponential backoff**
    - **Validates: Requirements 11.1, 11.2, 11.3**

  - [ ] 14.3 Add error handling in Deploy Engine

    - Handle artifact extraction failures
    - Handle symlink update failures
    - Handle process start failures
    - Handle health check failures with rollback
    - _Requirements: 11.4, 11.5_

  - [ ]\* 14.4 Write property test for deployment error handling

    - **Property 29: Deployment failure rollback**
    - **Validates: Requirements 11.4, 11.5**

  - [ ] 14.5 Add error handling in Control API

    - Handle database connection failures
    - Handle WebSocket disconnections
    - Handle Build Worker communication failures
    - Handle Deploy Engine communication failures
    - _Requirements: 10.5_

  - [ ]\* 14.6 Write property test for connection resilience
    - **Property 26: Connection resilience**
    - **Validates: Requirements 10.5**

- [ ] 15. Implement authentication and security

  - [ ] 15.1 Add JWT authentication to Control API

    - Implement JWT token generation
    - Add authentication middleware
    - Protect all API endpoints
    - _Requirements: 10.3_

  - [ ] 15.2 Implement environment variable encryption

    - Add AES-256-GCM encryption for env var values
    - Encrypt on write, decrypt on read
    - Store encryption key in environment variable
    - _Requirements: 2.1, 2.3_

  - [ ] 15.3 Add input validation

    - Validate project names, URLs, commands
    - Sanitize build commands to prevent injection
    - Validate domain names
    - Add build timeout (30 minutes)
    - _Requirements: 1.2_

  - [ ]\* 15.4 Write property test for authentication
    - **Property 24: Control API request processing**
    - **Validates: Requirements 10.3**

- [ ] 16. Add WebSocket communication tests

  - [ ]\* 16.1 Write property test for WebSocket protocol
    - **Property 23: UI communication protocol selection**
    - **Property 25: WebSocket push notifications**
    - **Validates: Requirements 10.1, 10.2, 10.4**

- [ ] 17. Implement health check endpoint

  - [ ] 17.1 Add health check endpoint in Deploy Engine

    - Create /api/health/:project_id endpoint
    - Return appropriate HTTP status codes
    - _Requirements: 9.5_

  - [ ]\* 17.2 Write property test for health checks
    - **Property 22: Health check responses**
    - **Validates: Requirements 9.5**

- [ ] 18. Add database indexes and optimization

  - [ ] 18.1 Create database indexes
    - Add index on project_id in builds table
    - Add index on build_id in deployments table
    - Add index on status in deployments table
    - _Requirements: All_

- [ ] 19. Create deployment scripts and documentation

  - [ ] 19.1 Create setup scripts

    - Create database initialization script
    - Create directory structure setup script (/var/mini-vercel/)
    - Create service startup scripts
    - _Requirements: All_

  - [ ] 19.2 Write README documentation
    - Document installation steps
    - Document configuration
    - Document API endpoints
    - Document development workflow
    - _Requirements: All_

- [ ] 20. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
