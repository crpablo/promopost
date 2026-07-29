import type { VercelConfig } from '@vercel/config/v1';

// Sem cron nativo da Vercel: contas Hobby só permitem agendamento diário, e
// o gatilho Telegram precisa rodar a cada poucos minutos. /api/telegram-poll
// é disparada por um serviço externo de cron (ver docs/runbook.md §9.4).
export const config: VercelConfig = {};
