import { describe, expect, it, vi } from 'vitest';
import { createBusinessForUser, getBusinessForUser } from './businesses';

function makePool(rows: unknown[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as import('pg').Pool;
}

describe('getBusinessForUser', () => {
  it('retorna null quando o usuário não tem business', async () => {
    const pool = makePool([]);
    const result = await getBusinessForUser(pool, 'user-1');
    expect(result).toBeNull();
    expect(pool.query).toHaveBeenCalledWith(
      'select id, owner_user_id, name, created_at from businesses where owner_user_id = $1',
      ['user-1'],
    );
  });

  it('retorna a business quando existe', async () => {
    const createdAt = new Date('2026-09-08T12:00:00Z');
    const pool = makePool([
      { id: '7', owner_user_id: 'user-1', name: 'Tobie Store', created_at: createdAt },
    ]);
    const result = await getBusinessForUser(pool, 'user-1');
    expect(result).toEqual({ id: '7', ownerUserId: 'user-1', name: 'Tobie Store', createdAt });
  });
});

describe('createBusinessForUser', () => {
  it('insere e retorna a business criada', async () => {
    const createdAt = new Date('2026-09-08T12:00:00Z');
    const pool = makePool([
      { id: '9', owner_user_id: 'user-2', name: 'Loja Nova', created_at: createdAt },
    ]);
    const result = await createBusinessForUser(pool, 'user-2', 'Loja Nova');
    expect(result).toEqual({ id: '9', ownerUserId: 'user-2', name: 'Loja Nova', createdAt });
    expect(pool.query).toHaveBeenCalledWith(
      'insert into businesses (owner_user_id, name) values ($1, $2) returning id, owner_user_id, name, created_at',
      ['user-2', 'Loja Nova'],
    );
  });
});
