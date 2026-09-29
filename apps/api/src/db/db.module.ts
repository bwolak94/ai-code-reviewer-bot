import { Global, Module } from '@nestjs/common';
import {
  InstallationRepository,
  ReviewRunRepository,
  FeedbackRepository,
  createDb,
} from '@repo/db';
import { getEnv } from '../config/env.js';

/**
 * Provides the Drizzle ORM database instance and repository classes as
 * injectable tokens for the API application.
 *
 * @Global() so repositories are available in sub-modules (InstallationModule,
 * WebhookModule, etc.) without explicit imports.
 */
@Global()
@Module({
  providers: [
    {
      provide: 'DRIZZLE_DB',
      useFactory: () => {
        const env = getEnv();
        const { db } = createDb(env.DATABASE_URL);
        return db;
      },
    },
    {
      provide: InstallationRepository,
      useFactory: (db: ReturnType<typeof createDb>['db']) =>
        new InstallationRepository(db),
      inject: ['DRIZZLE_DB'],
    },
    {
      provide: ReviewRunRepository,
      useFactory: (db: ReturnType<typeof createDb>['db']) =>
        new ReviewRunRepository(db),
      inject: ['DRIZZLE_DB'],
    },
    {
      provide: 'FEEDBACK_REPOSITORY',
      useFactory: (db: ReturnType<typeof createDb>['db']) =>
        new FeedbackRepository(db),
      inject: ['DRIZZLE_DB'],
    },
  ],
  exports: ['DRIZZLE_DB', InstallationRepository, ReviewRunRepository, 'FEEDBACK_REPOSITORY'],
})
export class DbModule {}
