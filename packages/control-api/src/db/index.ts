import { config } from '@thakur-deploy/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = config.databaseUrl;

// Connection pooling for production
const client = postgres(connectionString, {
  max: 10, // Maximum connections in pool
  idle_timeout: 20, // Close idle connections after 20 seconds
  connect_timeout: 10, // Connection timeout in seconds
});

export const db = drizzle(client, { schema });
