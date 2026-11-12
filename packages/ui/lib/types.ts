import { AppType } from './framework-config';

export interface Project {
  id: string;
  name: string;
  github_url: string;
  root_directory: string | null;
  build_command: string;
  /** Runs before each release goes live, e.g. database migrations. */
  pre_deploy_command?: string | null;
  app_type: AppType;
  domain: string | null;
  port?: number | null;
  github_repo_id: string | null;
  github_repo_full_name: string | null;
  github_branch: string | null;
  github_installation_id: string | null;
  auto_deploy: boolean;
  auto_deploy_paths: string | null;
  /** Builds kept after each successful deploy; null keeps all. */
  keep_builds?: number | null;
  created_at: string;
  updated_at: string;
  latest_build?: Pick<Build, 'id' | 'status' | 'created_at' | 'completed_at'> | null;
  latest_deployment?: {
    id: string;
    build_id: string;
    status: DeploymentStatus;
    status_message: string | null;
    activated_at: string;
  } | null;
  managed_process?: {
    name: string;
    pm_id: number;
    status: string;
    cpu: number;
    memory: number;
  } | null;
  uptime_status?: 'unknown' | 'up' | 'down' | null;
  /** True when visitors must enter a password to reach the deployed site. */
  access_protected?: boolean;
}

export type DeploymentStatus =
  | 'pending'
  | 'dns_creating'
  | 'dns_created'
  | 'ssl_issuing'
  | 'ssl_issued'
  | 'nginx_configuring'
  | 'nginx_configured'
  | 'app_starting'
  | 'health_checking'
  | 'active'
  | 'inactive'
  | 'failed';

export interface Build {
  id: string;
  project_id: string;
  status: 'pending' | 'building' | 'success' | 'failed';
  logs: string | null;
  artifact_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Deployment {
  id: string;
  project_id: string;
  build_id: string;
  status: 'active' | 'inactive';
  activated_at: string;
}

export interface AccessSettings {
  enabled: boolean;
  has_password: boolean;
  session_hours: number;
  /** False on development servers, where nothing sits in front of deployed apps. */
  enforced: boolean;
  domain: string | null;
}

export interface UptimeCheck {
  id: string;
  checked_at: string;
  success: boolean;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
}

export interface UptimeSummary {
  uptime_percentage: number | null;
  avg_latency_ms: number | null;
  total_checks: number;
  successful_checks: number;
  window_days: number;
}

export interface UptimeSettings {
  enabled: boolean;
  endpoint_url: string | null;
  interval_seconds: number;
  current_status: 'unknown' | 'up' | 'down';
  consecutive_failures: number;
  last_checked_at: string | null;
  down_since: string | null;
  history: UptimeCheck[];
  summary?: UptimeSummary;
}

export interface EnvVar {
  id: string;
  project_id: string;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

// Structured log types
export type LogLevel = 'info' | 'warning' | 'error' | 'success' | 'deploy';

export interface LogEntry {
  id: string;
  build_id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
}

// Infrastructure Services
export type ServiceType = 'redis' | 'postgres';
export type ServiceStatus = 'running' | 'stopped' | 'error' | 'starting';

export interface InfraService {
  id: string;
  name: string;
  service_type: ServiceType;
  container_id: string | null;
  container_name: string;
  host: string;
  port: number;
  status: ServiceStatus;
  version: string | null;
  bind_localhost: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Only available when fetching single service
  credentials?: {
    password: string;
    username?: string;
    database?: string;
  };
  connection_url?: string;
}

export interface MigrationSuggestion {
  command: string;
  reason: string;
  detail?: string;
}

/** A deployable folder found by the repository scan. */
export interface RepoFolder {
  path: string;
  name: string;
  framework: string | null;
  frameworkInfo: { name: string; icon: string; color: string };
  hasPackageJson: boolean;
  detectionReason?: string;
  preDeploy?: { command: string; reason: string } | null;
  preDeployOptions?: MigrationSuggestion[];
  migrationNotes?: string[];
  buildCommand?: { command: string; reason: string } | null;
  runtimeVersion?: string | null;
}
