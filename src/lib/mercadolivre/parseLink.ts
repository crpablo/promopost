export function parseItemId(link: string): string | null {
  const match = link.match(/MLB-?(\d{6,})/i);
  if (!match) {
    return null;
  }
  return `MLB${match[1]}`;
}
