import { config } from '@thakur-deploy/config';
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: config.databaseUrl,
  },
} satisfies Config;
