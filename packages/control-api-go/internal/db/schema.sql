-- Schema converted from Drizzle ORM schema.ts
-- For sqlc code generation

-- GitHub Installations (must come before projects due to FK)
CREATE TABLE github_installations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_installation_id TEXT NOT NULL UNIQUE,
    account_login TEXT NOT NULL,
    account_id TEXT NOT NULL,
    account_type TEXT NOT NULL, -- 'User' or 'Organization'
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Projects
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    github_url TEXT NOT NULL,
    root_directory TEXT DEFAULT './',
    build_command TEXT NOT NULL,
    app_type VARCHAR(50) NOT NULL, -- 'nextjs' | 'vite' | 'express' | 'hono' | 'elysia'
    domain VARCHAR(255) UNIQUE,
    port INTEGER UNIQUE,
    github_repo_id TEXT,
    github_repo_full_name TEXT,
    github_branch TEXT DEFAULT 'main',
    github_installation_id TEXT REFERENCES github_installations(github_installation_id),
    auto_deploy BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX projects_github_repo_idx ON projects(github_repo_id, github_branch);

-- Builds
CREATE TABLE builds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id),
    status VARCHAR(50) NOT NULL, -- 'pending' | 'building' | 'success' | 'failed'
    commit_sha TEXT,
    commit_message TEXT,
    logs TEXT,
    artifact_id VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX builds_project_id_idx ON builds(project_id);

-- Deployments
CREATE TABLE deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id),
    build_id UUID NOT NULL REFERENCES builds(id),
    status VARCHAR(50) NOT NULL, -- 'active' | 'inactive'
    activated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX deployments_build_id_idx ON deployments(build_id);
CREATE INDEX deployments_status_idx ON deployments(status);

-- Environment Variables
CREATE TABLE environment_variables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id),
    key VARCHAR(255) NOT NULL,
    value TEXT NOT NULL, -- Encrypted
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX env_vars_project_id_idx ON environment_variables(project_id);
CREATE UNIQUE INDEX env_vars_project_key_unique ON environment_variables(project_id, key);

-- Users (better-auth compatible)
CREATE TABLE "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified BOOLEAN NOT NULL,
    image TEXT,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

-- Sessions
CREATE TABLE session (
    id TEXT PRIMARY KEY,
    expires_at TIMESTAMP NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    user_id TEXT NOT NULL REFERENCES "user"(id)
);

-- Accounts (OAuth)
CREATE TABLE account (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES "user"(id),
    access_token TEXT,
    refresh_token TEXT,
    id_token TEXT,
    access_token_expires_at TIMESTAMP,
    refresh_token_expires_at TIMESTAMP,
    scope TEXT,
    password TEXT,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

-- Verification tokens
CREATE TABLE verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Build Logs (structured)
CREATE TABLE build_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    build_id UUID NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
    level VARCHAR(20) NOT NULL, -- 'info' | 'warning' | 'error' | 'success' | 'deploy'
    message TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX build_logs_build_id_idx ON build_logs(build_id);
CREATE INDEX build_logs_timestamp_idx ON build_logs(build_id, timestamp);
