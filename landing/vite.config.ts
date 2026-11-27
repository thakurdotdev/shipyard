import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * Serves the platform installer at /install.sh, so the site can advertise
 * `curl -fsSL https://shipyard.thakur.dev/install.sh | bash`.
 *
 * The file is read from ../scripts/install.sh on every build instead of being
 * copied into the repo, so the site always ships the installer from the same
 * commit. A missing script fails the build rather than letting Nginx answer
 * /install.sh with the HTML page.
 */
const INSTALL_SCRIPT = fileURLToPath(new URL('../scripts/install.sh', import.meta.url));

function installScript(): Plugin {
  return {
    name: 'shipyard-install-script',
    configureServer(server) {
      server.middlewares.use('/install.sh', (_req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(readFileSync(INSTALL_SCRIPT));
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'install.sh',
        source: readFileSync(INSTALL_SCRIPT, 'utf8'),
      });
    },
  };
}

export default defineConfig({
  plugins: [installScript()],
  server: { allowedHosts: ['.tunl.online'] },
  preview: { allowedHosts: ['.tunl.online'] },
});
