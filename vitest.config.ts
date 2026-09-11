import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Sem isso, um worktree com node_modules instalado sob .claude/worktrees/
    // (comum neste projeto, que usa worktrees pra implementar planos) faz o
    // vitest descobrir e rodar os mesmos arquivos de teste duas vezes quando
    // rodado a partir da raiz do checkout principal.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
