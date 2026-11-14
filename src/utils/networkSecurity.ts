import { isIP } from 'node:net';

/**
 * Return true only for globally routable unicast addresses.
 * Conservative exclusions intentionally cover IANA special-purpose ranges.
 */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }
    const [a, b, c] = octets;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    ) {
      return false;
    }
    return true;
  }

  if (version === 6) {
    const normalized = address.toLowerCase();
    // Global unicast is 2000::/3. Exclude documentation and Teredo ranges.
    return (
      /^[23][0-9a-f]{3}:/.test(normalized) &&
      !normalized.startsWith('2001:db8:') &&
      !/^2001:0{1,4}:/i.test(normalized)
    );
  }

  return false;
}
