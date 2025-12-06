import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  github_url: text("github_url").notNull(),
  root_directory: text("root_directory").default("./"),
  build_command: text("build_command").notNull(),
  app_type: varchar("app_type", { length: 50 }).notNull(), // 'nextjs' | 'vite'
  domain: varchar("domain", { length: 255 }).unique(),
  port: integer("port").unique(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const builds = pgTable(
  "builds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    project_id: uuid("project_id")
      .references(() => projects.id)
      .notNull(),
    status: varchar("status", { length: 50 }).notNull(), // 'pending' | 'building' | 'success' | 'failed'
    logs: text("logs"),
    artifact_id: varchar("artifact_id", { length: 255 }),
    created_at: timestamp("created_at").defaultNow().notNull(),
    completed_at: timestamp("completed_at"),
  },
  (table) => {
    return {
      projectIdIdx: index("builds_project_id_idx").on(table.project_id),
    };
  },
);

export const deployments = pgTable(
  "deployments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    project_id: uuid("project_id")
      .references(() => projects.id)
      .notNull(),
    build_id: uuid("build_id")
      .references(() => builds.id)
      .notNull(),
    status: varchar("status", { length: 50 }).notNull(), // 'active' | 'inactive'
    activated_at: timestamp("activated_at").defaultNow().notNull(),
  },
  (table) => {
    return {
      buildIdIdx: index("deployments_build_id_idx").on(table.build_id),
      statusIdx: index("deployments_status_idx").on(table.status),
    };
  },
);

export const environmentVariables = pgTable(
  "environment_variables",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    project_id: uuid("project_id")
      .references(() => projects.id)
      .notNull(),
    key: varchar("key", { length: 255 }).notNull(),
    value: text("value").notNull(), // Encrypted
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => {
    return {
      projectIdIdx: index("env_vars_project_id_idx").on(table.project_id),
    };
  },
);
