import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

function dataDir(): string {
  return process.env.DATA_DIR || '/data';
}

export function resolveDataPath(filename: string): string {
  return path.join(dataDir(), filename);
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export async function readJsonFile<T>(filename: string): Promise<T | null> {
  try {
    const raw = await readFile(resolveDataPath(filename), 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

export async function writeJsonFile(filename: string, data: unknown): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(resolveDataPath(filename), JSON.stringify(data), 'utf8');
}

export async function readTextFile(filename: string): Promise<string | null> {
  try {
    const raw = await readFile(resolveDataPath(filename), 'utf8');
    return raw.trim();
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

export async function writeTextFile(filename: string, content: string): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(resolveDataPath(filename), content, 'utf8');
}

export async function readBufferFile(filename: string): Promise<Buffer | null> {
  try {
    return await readFile(resolveDataPath(filename));
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

export async function writeBufferFile(filename: string, data: Buffer): Promise<void> {
  const fullPath = resolveDataPath(filename);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, data);
}

export async function fileAgeMs(filename: string): Promise<number | null> {
  try {
    const info = await stat(resolveDataPath(filename));
    return Date.now() - info.mtimeMs;
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

export async function deleteFile(filename: string): Promise<void> {
  await rm(resolveDataPath(filename), { force: true });
}
