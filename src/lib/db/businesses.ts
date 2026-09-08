import type { Pool } from 'pg';

export interface Business {
  id: number;
  ownerUserId: string;
  name: string;
  createdAt: Date;
}

function toBusiness(row: {
  id: number;
  owner_user_id: string;
  name: string;
  created_at: Date;
}): Business {
  return { id: row.id, ownerUserId: row.owner_user_id, name: row.name, createdAt: row.created_at };
}

export async function getBusinessForUser(pool: Pool, userId: string): Promise<Business | null> {
  const result = await pool.query(
    'select id, owner_user_id, name, created_at from businesses where owner_user_id = $1',
    [userId],
  );
  const row = result.rows[0];
  return row ? toBusiness(row) : null;
}

export async function createBusinessForUser(
  pool: Pool,
  userId: string,
  name: string,
): Promise<Business> {
  const result = await pool.query(
    'insert into businesses (owner_user_id, name) values ($1, $2) returning id, owner_user_id, name, created_at',
    [userId, name],
  );
  return toBusiness(result.rows[0]);
}
