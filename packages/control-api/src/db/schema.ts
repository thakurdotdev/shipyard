import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  boolean,
} from 'drizzle-orm/pg-core';

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  github_url: text('github_url').notNull(),
  root_directory: text('root_directory').default('./'),
  build_command: text('build_command').notNull(),
  app_type: varchar('app_type', { length: 50 }).notNull(), // 'nextjs' | 'vite'
  domain: varchar('domain', { length: 255 }).unique(),
  port: integer('port').unique(),
  github_repo_id: text('github_repo_id'),
  github_repo_full_name: text('github_repo_full_name'),
  github_branch: text('github_branch').default('main'),
  github_installation_id: text('github_installation_id').references(
    () => githubInstallations.github_installation_id,
  ),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

export const builds = pgTable(
  'builds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    project_id: uuid('project_id')
      .references(() => projects.id)
      .notNull(),
    status: varchar('status', { length: 50 }).notNull(), // 'pending' | 'building' | 'success' | 'failed'
    logs: text('logs'),
    artifact_id: varchar('artifact_id', { length: 255 }),
    created_at: timestamp('created_at').defaultNow().notNull(),
    completed_at: timestamp('completed_at'),
  },
  (table) => {
    return {
      projectIdIdx: index('builds_project_id_idx').on(table.project_id),
    };
  },
);

export const deployments = pgTable(
  'deployments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    project_id: uuid('project_id')
      .references(() => projects.id)
      .notNull(),
    build_id: uuid('build_id')
      .references(() => builds.id)
      .notNull(),
    status: varchar('status', { length: 50 }).notNull(), // 'active' | 'inactive'
    activated_at: timestamp('activated_at').defaultNow().notNull(),
  },
  (table) => {
    return {
      buildIdIdx: index('deployments_build_id_idx').on(table.build_id),
      statusIdx: index('deployments_status_idx').on(table.status),
    };
  },
);

export const environmentVariables = pgTable(
  'environment_variables',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    project_id: uuid('project_id')
      .references(() => projects.id)
      .notNull(),
    key: varchar('key', { length: 255 }).notNull(),
    value: text('value').notNull(), // Encrypted
    created_at: timestamp('created_at').defaultNow().notNull(),
    updated_at: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => {
    return {
      projectIdIdx: index('env_vars_project_id_idx').on(table.project_id),
    };
  },
);

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

export const githubInstallations = pgTable('github_installations', {
  id: uuid('id').defaultRandom().primaryKey(),
  github_installation_id: text('github_installation_id').notNull().unique(),
  account_login: text('account_login').notNull(),
  account_id: text('account_id').notNull(),
  account_type: text('account_type').notNull(), // 'User' or 'Organization'
  created_at: timestamp('created_at').defaultNow().notNull(),
});
