import { config, internalAuthHeaders } from '@shipyard/config';

/**
 * fetch() against the Deploy Engine with the internal token attached. The engine rejects
 * calls without it: deployed apps share the host and can reach its loopback port.
 */
export function deployEngineFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(internalAuthHeaders())) headers.set(key, value);
  return fetch(`${config.deployEngineUrl}${path}`, { ...init, headers });
}
