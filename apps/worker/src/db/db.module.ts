import { Global, Module } from '@nestjs/common';
import {
  createDb,
  InstallationRepository,
  ReviewRunRepository,
  FindingRepository,
} from '@repo/db';
import { getWorkerEnv } from '../config/env.js';

/**
 * Provides Drizzle ORM database instance and repositories for the worker.
 * @Global() so repositories are available in all worker sub-modules without
 * explicit imports.
 */
@Global()
@Module({
  providers: [
    {
      provide: 'DRIZZLE_DB',
      useFactory: () => {
        const env = getWorkerEnv();
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
      provide: FindingRepository,
      useFactory: (db: ReturnType<typeof createDb>['db']) =>
        new FindingRepository(db),
      inject: ['DRIZZLE_DB'],
    },
  ],
  exports: ['DRIZZLE_DB', InstallationRepository, ReviewRunRepository, FindingRepository],
})
export class WorkerDbModule {}
