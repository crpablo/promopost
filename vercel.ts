import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  crons: [{ path: '/api/telegram-poll', schedule: '*/3 * * * *' }],
};
