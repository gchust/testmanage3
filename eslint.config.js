import { createPortalConfig } from '@nocobase/dev-config/eslint';

export default createPortalConfig({
  tsconfigRootDir: import.meta.dirname,
  ignores: [
    '.extension-state/**',
    'client-old/**',
    'public/r/**',
    'storage/**',
    // Generated snapshot seed: its exact bytes are the checksum recorded in the
    // seed history of every database that ran it, so formatting must not change it.
    'database/main/seeds/202609220007_seed_curated_tracker_snapshot.ts',
  ],
});
