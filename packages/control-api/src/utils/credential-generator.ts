import { randomBytes } from 'crypto';

/**
 * Generate a cryptographically secure random password
 */
export function generatePassword(length: number = 32): string {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(length);
  let password = '';

  for (let i = 0; i < length; i++) {
    password += charset[bytes[i] % charset.length];
  }

  return password;
}

/**
 * Generate a safe username for PostgreSQL
 */
export function generateUsername(): string {
  const prefix = 'user_';
  const suffix = randomBytes(4).toString('hex');
  return prefix + suffix;
}

/**
 * Generate a safe database name for PostgreSQL
 */
export function generateDatabaseName(serviceName: string): string {
  // Sanitize service name: lowercase, replace non-alphanumeric with underscore
  const sanitized = serviceName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 20);

  return sanitized || 'main';
}

/**
 * Redis credentials structure
 */
export interface RedisCredentials {
  password: string;
}

/**
 * PostgreSQL credentials structure
 */
export interface PostgresCredentials {
  username: string;
  password: string;
  database: string;
}

/**
 * Generate credentials for a service type
 */
export function generateCredentials(
  serviceType: 'redis' | 'postgres',
  serviceName: string,
): RedisCredentials | PostgresCredentials {
  if (serviceType === 'redis') {
    return {
      password: generatePassword(32),
    };
  }

  return {
    username: generateUsername(),
    password: generatePassword(32),
    database: generateDatabaseName(serviceName),
  };
}

/**
 * Generate connection URL for a service
 */
export function generateConnectionUrl(
  serviceType: 'redis' | 'postgres',
  host: string,
  port: number,
  credentials: RedisCredentials | PostgresCredentials,
): string {
  if (serviceType === 'redis') {
    const redisCreds = credentials as RedisCredentials;
    return `redis://:${redisCreds.password}@${host}:${port}`;
  }

  const pgCreds = credentials as PostgresCredentials;
  return `postgresql://${pgCreds.username}:${pgCreds.password}@${host}:${port}/${pgCreds.database}`;
}
