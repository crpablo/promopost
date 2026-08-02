import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'promopost-localstore-test-'));
  vi.stubEnv('DATA_DIR', dataDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(dataDir, { recursive: true, force: true });
});

describe('resolveDataPath', () => {
  it('junta o DATA_DIR configurado com o nome do arquivo', async () => {
    const { resolveDataPath } = await import('./localStore');
    expect(resolveDataPath('foo.json')).toBe(path.join(dataDir, 'foo.json'));
  });
});

describe('readJsonFile / writeJsonFile', () => {
  it('retorna null quando o arquivo não existe', async () => {
    const { readJsonFile } = await import('./localStore');
    const data = await readJsonFile('missing.json');
    expect(data).toBeNull();
  });

  it('escreve e lê de volta o mesmo JSON, criando o diretório se preciso', async () => {
    const nestedDir = path.join(dataDir, 'nested');
    vi.stubEnv('DATA_DIR', nestedDir);
    const { readJsonFile, writeJsonFile } = await import('./localStore');

    await writeJsonFile('foo.json', { a: 1 });
    const data = await readJsonFile<{ a: number }>('foo.json');

    expect(data).toEqual({ a: 1 });
  });
});

describe('readTextFile / writeTextFile', () => {
  it('retorna null quando o arquivo não existe', async () => {
    const { readTextFile } = await import('./localStore');
    expect(await readTextFile('missing.txt')).toBeNull();
  });

  it('escreve e lê de volta o texto, sem espaços nas pontas', async () => {
    const { readTextFile, writeTextFile } = await import('./localStore');
    await writeTextFile('foo.txt', '  conteudo  \n');
    expect(await readTextFile('foo.txt')).toBe('conteudo');
  });
});

describe('readBufferFile', () => {
  it('retorna null quando o arquivo não existe', async () => {
    const { readBufferFile } = await import('./localStore');
    expect(await readBufferFile('missing.bin')).toBeNull();
  });

  it('retorna o conteúdo como Buffer', async () => {
    const { readBufferFile, writeJsonFile } = await import('./localStore');
    await writeJsonFile('foo.json', { a: 1 });
    const buffer = await readBufferFile('foo.json');
    expect(buffer?.toString()).toBe(JSON.stringify({ a: 1 }));
  });
});

describe('fileAgeMs', () => {
  it('retorna null quando o arquivo não existe', async () => {
    const { fileAgeMs } = await import('./localStore');
    expect(await fileAgeMs('missing.lock')).toBeNull();
  });

  it('retorna a idade em ms de um arquivo recém-escrito, próxima de zero', async () => {
    const { fileAgeMs, writeTextFile } = await import('./localStore');
    await writeTextFile('foo.lock', String(Date.now()));
    const age = await fileAgeMs('foo.lock');
    expect(age).not.toBeNull();
    expect(age as number).toBeGreaterThanOrEqual(0);
    expect(age as number).toBeLessThan(2000);
  });
});

describe('deleteFile', () => {
  it('apaga um arquivo existente', async () => {
    const { deleteFile, readTextFile, writeTextFile } = await import('./localStore');
    await writeTextFile('foo.txt', 'x');
    await deleteFile('foo.txt');
    expect(await readTextFile('foo.txt')).toBeNull();
  });

  it('não lança erro quando o arquivo não existe', async () => {
    const { deleteFile } = await import('./localStore');
    await expect(deleteFile('missing.txt')).resolves.toBeUndefined();
  });
});
