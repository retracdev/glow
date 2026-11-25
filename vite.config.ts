import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const VERSION_FILE = fileURLToPath(new URL('./version.yml', import.meta.url));

function readVersion(): { source: string; version: string } {
  const source = readFileSync(VERSION_FILE, 'utf8');
  const match = /^\s*version\s*:\s*(["']?)([^"'\s#]+)\1/m.exec(source);
  if (!match || !/^\d+(\.\d+){0,3}(-[0-9A-Za-z.-]+)?$/.test(match[2])) {
    throw new Error('version.yml needs a line like: version: "1.1"');
  }
  return { source, version: match[2] };
}

// version.yml is the one place the version lives. The build writes it into
// <meta name="glow-version"> (%GLOW_VERSION% in index.html) and publishes version.yml beside
// the page, so both always match. Open tabs poll that file through public/live-update.js.
function glowVersion(): Plugin {
  return {
    name: 'glow-version',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%GLOW_VERSION%', readVersion().version),
    },
    configureServer(server) {
      server.watcher.add(VERSION_FILE);
      server.middlewares.use('/version.yml', (_req, res) => {
        res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(readVersion().source);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.yml', source: readVersion().source });
    },
  };
}

export default defineConfig({
  plugins: [react(), glowVersion()],
});
