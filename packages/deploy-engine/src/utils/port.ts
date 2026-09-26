import { createServer } from 'net';

/**
 * Default port range for deployed applications.
 * Override with PORT_RANGE_START and PORT_RANGE_END env vars.
 */
const PORT_RANGE_START = parseInt(process.env.PORT_RANGE_START || '5000', 10);
const PORT_RANGE_END = parseInt(process.env.PORT_RANGE_END || '6000', 10);

export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        // Other error (permission?), assume unavailable to be safe
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port);
  });
}

/**
 * Find the next available port in the configured range.
 * Uses TCP bind to verify port availability (works for any protocol, not just HTTP).
 *
 * @param startPort - Start of port range (default: PORT_RANGE_START env or 5000)
 * @param endPort - End of port range (default: PORT_RANGE_END env or 6000)
 * @returns The first available port, or null if none found
 */
export async function findAvailablePort(
  startPort: number = PORT_RANGE_START,
  endPort: number = PORT_RANGE_END,
): Promise<number | null> {
  for (let port = startPort; port <= endPort; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  return null;
}
