#!/usr/bin/env node

/**
 * Node script to inject Firebase configuration keys from environment variables
 * into `src/environments/environment.ts` at build time.
 *
 * This prevents secrets from being committed to public repositories when
 * building inside CI/CD environments (like GitHub Actions).
 *
 * Setup:
 *   1. Set the following environment variables in your build runner:
 *      - FB_ENABLED ("true" or "false")
 *      - FB_API_KEY
 *      - FB_AUTH_DOMAIN
 *      - FB_PROJECT_ID
 *      - FB_STORAGE_BUCKET
 *      - FB_MESSAGING_SENDER_ID
 *      - FB_APP_ID
 *      - FB_MEASUREMENT_ID
 *   2. Run `node scripts/inject-env.mjs` before triggering `npm run build` or `npm run tauri:build`.
 */

import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENV_PATH = join(ROOT, 'src/environments/environment.ts');

const {
  FB_ENABLED,
  FB_API_KEY,
  FB_AUTH_DOMAIN,
  FB_PROJECT_ID,
  FB_STORAGE_BUCKET,
  FB_MESSAGING_SENDER_ID,
  FB_APP_ID,
  FB_MEASUREMENT_ID,
} = process.env;

const hasEnvVars = 
  FB_API_KEY || 
  FB_AUTH_DOMAIN || 
  FB_PROJECT_ID || 
  FB_STORAGE_BUCKET || 
  FB_MESSAGING_SENDER_ID || 
  FB_APP_ID || 
  FB_MEASUREMENT_ID;

// If we are running locally and environment.ts already exists,
// don't overwrite it unless environment variables are provided.
// This prevents wiping local developer keys.
if (!hasEnvVars && existsSync(ENV_PATH)) {
  console.log('[+] environment.ts already exists and no build env variables are defined. Keeping existing config.');
  process.exit(0);
}

const enabled = FB_ENABLED === 'true' || (hasEnvVars && FB_ENABLED !== 'false');

const envContent = `/**
 * App-wide environment values.
 *
 * NOTE: This file is dynamically generated during builds from environment variables
 * (via scripts/inject-env.mjs). Do not commit secrets here.
 */
export const environment = {
  version: '0.1.2',
  production: true,

  firebase: {
    /** Master switch. Set to \`false\` to disable all cloud features. */
    enabled: ${enabled},
    apiKey: ${JSON.stringify(FB_API_KEY || '')},
    authDomain: ${JSON.stringify(FB_AUTH_DOMAIN || '')},
    projectId: ${JSON.stringify(FB_PROJECT_ID || '')},
    storageBucket: ${JSON.stringify(FB_STORAGE_BUCKET || '')},
    messagingSenderId: ${JSON.stringify(FB_MESSAGING_SENDER_ID || '')},
    appId: ${JSON.stringify(FB_APP_ID || '')},
    measurementId: ${JSON.stringify(FB_MEASUREMENT_ID || '')}
  },
};
`;

try {
  writeFileSync(ENV_PATH, envContent, 'utf8');
  console.log(`[+] successfully generated ${ENV_PATH}`);
} catch (err) {
  console.error('[-] Failed to write environment.ts:', err);
  process.exit(1);
}
