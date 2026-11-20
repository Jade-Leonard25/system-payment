import { compare, hash } from "bcryptjs";

const KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function generateKeySegment(): string {
  let segment = "";
  const randomBytes = new Uint8Array(16);

  while (segment.length < 3) {
    crypto.getRandomValues(randomBytes);
    for (const byte of randomBytes) {
      if (byte >= 252) continue;
      segment += KEY_ALPHABET.charAt(byte % KEY_ALPHABET.length);
      if (segment.length === 3) break;
    }
  }

  return segment;
}

export function generateProductKey(keySelector = generateKeySegment()) {
  return {
    key: `${keySelector}-${generateKeySegment()}-${generateKeySegment()}`,
    keySelector,
  };
}

export function isProductKeyFormat(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]{3}(?:-[a-z0-9]{3}){2}$/i.test(value);
}

export function hashProductKey(key: string): Promise<string> {
  return hash(key, 10);
}

export function verifyProductKey(key: string, keyHash: string): Promise<boolean> {
  return compare(key, keyHash);
}
