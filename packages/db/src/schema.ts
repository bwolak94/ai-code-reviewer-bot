import {
  pgTable,
  bigint,
  text,
  jsonb,
  integer,
  timestamp,
  boolean,
  uuid,
  date,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Installations table: tracks GitHub App installations per account/org.
 * Multi-tenant root entity — all other tables reference this via installationId.
 */
export const installations = pgTable('installations', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  accountLogin: text('account_login').notNull(),
  accountType: text('account_type').notNull(),
  settings: jsonb('settings').default({}).notNull(),
  monthlyTokenLimit: integer('monthly_token_limit').default(500_000).notNull(),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

/**
 * Repositories table: tracks GitHub repositories accessible to an installation.
 */
export const repositories = pgTable(
  'repositories',
  {
    id: bigint('id', { mode: 'number' }).primaryKey(),
    installationId: bigint('installation_id', { mode: 'number' })
      .notNull()
      .references(() => installations.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
  },
  (table) => ({
    installationIdIdx: index('repositories_installation_id_idx').on(
      table.installationId,
    ),
  }),
);

/**
 * Review runs table: one row per PR review attempt.
 * status transitions: queued → running → completed | failed | superseded
 */
export const reviewRuns = pgTable(
  'review_runs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number').notNull(),
    baseSha: text('base_sha').notNull(),
    headSha: text('head_sha').notNull(),
    checkRunId: bigint('check_run_id', { mode: 'number' }),
    status: text('status').default('queued').notNull(),
    tokensIn: integer('tokens_in').default(0).notNull(),
    tokensOut: integer('tokens_out').default(0).notNull(),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => ({
    repositoryPrIdx: index('review_runs_repository_pr_idx').on(
      table.repositoryId,
      table.prNumber,
    ),
  }),
);

/**
 * Findings table: individual issues found during a review run.
 * fingerprint enables deduplication across runs.
 */
export const findings = pgTable(
  'findings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    runId: uuid('run_id')
      .notNull()
      .references(() => reviewRuns.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    source: text('source').notNull(),
    ruleOrCategory: text('rule_or_category').notNull(),
    severity: text('severity').notNull(),
    file: text('file').notNull(),
    line: integer('line'),
    rationale: text('rationale').notNull(),
    githubCommentId: bigint('github_comment_id', { mode: 'number' }),
  },
  (table) => ({
    runIdIdx: index('findings_run_id_idx').on(table.runId),
    fingerprintIdx: index('findings_fingerprint_idx').on(table.fingerprint),
  }),
);

/**
 * Feedback table: thumbs up/down signals collected from PR authors and reviewers.
 */
export const feedback = pgTable('feedback', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  findingId: uuid('finding_id')
    .notNull()
    .references(() => findings.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  actorLogin: text('actor_login').notNull(),
});

/**
 * Usage periods table: monthly token consumption per installation.
 * Used for billing cap enforcement and analytics.
 */
export const usagePeriods = pgTable(
  'usage_periods',
  {
    installationId: bigint('installation_id', { mode: 'number' })
      .notNull()
      .references(() => installations.id, { onDelete: 'cascade' }),
    period: date('period').notNull(),
    tokensTotal: integer('tokens_total').default(0).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.installationId, table.period] }),
    installationPeriodIdx: index('usage_periods_installation_period_idx').on(
      table.installationId,
      table.period,
    ),
  }),
);

export type Installation = typeof installations.$inferSelect;
export type NewInstallation = typeof installations.$inferInsert;
export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
export type ReviewRun = typeof reviewRuns.$inferSelect;
export type NewReviewRun = typeof reviewRuns.$inferInsert;
export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;
export type UsagePeriod = typeof usagePeriods.$inferSelect;
export type NewUsagePeriod = typeof usagePeriods.$inferInsert;
