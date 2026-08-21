import { randomBytes } from 'node:crypto';

/** Crockford base32 — no I, L, O or U, so an id read aloud or retyped stays unambiguous. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encode(value: number, length: number): string {
  let out = '';
  let n = value;
  for (let i = 0; i < length; i++) {
    out = ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

/**
 * A ULID: 48 bits of millisecond timestamp then 80 bits of randomness, base32.
 * Lexicographically sortable by creation time, collision-free in practice, and no
 * counter to keep anywhere. Hand-rolled because it is 20 lines and not worth a dependency.
 */
export function ulid(now = Date.now()): string {
  const random = randomBytes(10);
  let tail = '';
  // 80 random bits -> 16 base32 characters, five bits at a time.
  let bits = 0;
  let acc = 0;
  for (const byte of random) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      tail += ALPHABET[(acc >> bits) & 31];
    }
  }
  return encode(now, 10) + tail.slice(0, 16);
}

/** A filename-safe slug. Falls back to a stable stub so an emoji-only title still gets a file. */
export function slugify(title: string, fallback = 'task'): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || fallback;
}
