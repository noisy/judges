import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.worktree/**', '.worktrees/**', 'node_modules/**'],
    setupFiles: ['tests/setup/git-env.ts']
  }
});
