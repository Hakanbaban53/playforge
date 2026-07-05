/**
 * App-wide environment values.
 *
 * `version` is bumped manually when `package.json` version changes.
 * (The previous sidebar footer hard-coded `v0.1.0`, which silently desynced
 * from `package.json`. Centralizing it here is one source of truth.)
 *
 * If you want this auto-injected at build time, add a `fileReplacements`
 * entry to `angular.json`'s production config and create a
 * `environment.prod.ts` that overrides these values.
 */
export const environment = {
  version: '0.1.1',
  production: false,
};
