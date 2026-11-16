export interface SaavnImageEntry {
  quality: string;
  url: string;
}

export interface SaavnDownloadEntry {
  quality: string;
  url: string;
}

export interface SaavnArtistCredit {
  id?: string;
  name?: string;
  role?: string;
  url?: string;
}

export interface SaavnNormalizedSong {
  id: string;
  name: string;
  type: string;
  year?: string;
  duration: number;
  language?: string;
  playCount?: number;
  url?: string;
  album?: { id?: string; name?: string; url?: string };
  artists: {
    primary: SaavnArtistCredit[];
    featured: SaavnArtistCredit[];
    all: SaavnArtistCredit[];
  };
  image: SaavnImageEntry[];
  downloadUrl: SaavnDownloadEntry[];
}

export interface NativeSaavnArtistMapEntry {
  id?: string;
  name?: string;
  role?: string;
  perma_url?: string;
}

export interface NativeSaavnSongRaw {
  id?: string;
  title?: string;
  song?: string;
  type?: string;
  year?: string;
  language?: string;
  play_count?: string | number;
  perma_url?: string;
  image?: string;
  more_info?: {
    music?: string;
    album_id?: string;
    album?: string;
    album_url?: string;
    duration?: string | number;
    encrypted_media_url?: string;
    '320kbps'?: string | boolean;
    rights?: {
      code?: string | number;
      reason?: string;
    };
    artistMap?: {
      primary_artists?: NativeSaavnArtistMapEntry[];
      featured_artists?: NativeSaavnArtistMapEntry[];
      artists?: NativeSaavnArtistMapEntry[];
    };
  };
}

export interface NativeSaavnAlbumRaw {
  id?: string;
  title?: string;
  year?: string;
  image?: string;
  music?: string;
  perma_url?: string;
  more_info?: {
    year?: string;
    music?: string;
    artistMap?: {
      primary_artists?: NativeSaavnArtistMapEntry[];
      artists?: NativeSaavnArtistMapEntry[];
    };
  };
}

export interface NativeSaavnArtistRaw {
  id?: string;
  name?: string;
  title?: string;
  image?: string;
  perma_url?: string;
}

export const JIOSAAVN_NATIVE_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'X-Forwarded-For': '49.36.128.1',
};

// Standard FIPS 46-3 DES tables for pure-TS ECB decryption (works identically in
// Node 22 OpenSSL 3 and Cloudflare Workers without legacy OpenSSL flags).
const DES_IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];

const DES_FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
];

const DES_E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9,
  8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17,
  16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25,
  24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
];

const DES_P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
  2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
];

const DES_PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
  10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
  14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
];

const DES_PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10,
  23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48,
  44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];

const DES_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

const DES_SBOX = [
  [
    [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7],
    [0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8],
    [4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0],
    [15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  ],
  [
    [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10],
    [3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5],
    [0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15],
    [13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  ],
  [
    [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8],
    [13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1],
    [13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7],
    [1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  ],
  [
    [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15],
    [13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9],
    [10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4],
    [3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  ],
  [
    [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9],
    [14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6],
    [4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14],
    [11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  ],
  [
    [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11],
    [10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8],
    [9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6],
    [4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  ],
  [
    [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1],
    [13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6],
    [1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2],
    [6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  ],
  [
    [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7],
    [1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2],
    [7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8],
    [2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
  ],
];

function getBit(bytes: Uint8Array, pos1Based: number): number {
  const idx = pos1Based - 1;
  return (bytes[idx >> 3] >> (7 - (idx & 7))) & 1;
}

function setBit(bytes: Uint8Array, pos1Based: number, bit: number): void {
  const idx = pos1Based - 1;
  const byteIdx = idx >> 3;
  const mask = 1 << (7 - (idx & 7));
  if (bit) bytes[byteIdx] |= mask;
  else bytes[byteIdx] &= ~mask;
}

function permuteBits(src: Uint8Array, table: number[]): Uint8Array {
  const out = new Uint8Array(Math.ceil(table.length / 8));
  for (let i = 0; i < table.length; i += 1) {
    setBit(out, i + 1, getBit(src, table[i]));
  }
  return out;
}

function deriveDesSubkeys(keyStr: string): Uint8Array[] {
  const keyBytes = new Uint8Array(8);
  for (let i = 0; i < 8 && i < keyStr.length; i += 1) {
    keyBytes[i] = keyStr.charCodeAt(i) & 0xff;
  }
  const pc1 = permuteBits(keyBytes, DES_PC1);
  let c = 0;
  let d = 0;
  for (let i = 0; i < 28; i += 1) {
    c = (c << 1) | getBit(pc1, i + 1);
    d = (d << 1) | getBit(pc1, i + 29);
  }
  const subkeys: Uint8Array[] = [];
  for (let round = 0; round < 16; round += 1) {
    const shift = DES_SHIFTS[round];
    c = ((c << shift) | (c >>> (28 - shift))) & 0x0fffffff;
    d = ((d << shift) | (d >>> (28 - shift))) & 0x0fffffff;
    const cd = new Uint8Array(7);
    for (let i = 0; i < 28; i += 1) {
      setBit(cd, i + 1, (c >>> (27 - i)) & 1);
      setBit(cd, i + 29, (d >>> (27 - i)) & 1);
    }
    subkeys.push(permuteBits(cd, DES_PC2));
  }
  return subkeys;
}

const SAAVN_DES_SUBKEYS = deriveDesSubkeys('38346591');

function desFeistel(right: Uint8Array, subkey: Uint8Array): Uint8Array {
  const expanded = permuteBits(right, DES_E);
  for (let i = 0; i < 6; i += 1) expanded[i] ^= subkey[i];
  const sOut = new Uint8Array(4);
  for (let box = 0; box < 8; box += 1) {
    const bitOff = box * 6;
    const b0 = getBit(expanded, bitOff + 1);
    const b1 = getBit(expanded, bitOff + 2);
    const b2 = getBit(expanded, bitOff + 3);
    const b3 = getBit(expanded, bitOff + 4);
    const b4 = getBit(expanded, bitOff + 5);
    const b5 = getBit(expanded, bitOff + 6);
    const row = (b0 << 1) | b5;
    const col = (b1 << 3) | (b2 << 2) | (b3 << 1) | b4;
    const val = DES_SBOX[box][row][col];
    if ((box & 1) === 0) sOut[box >> 1] |= val << 4;
    else sOut[box >> 1] |= val;
  }
  return permuteBits(sOut, DES_P);
}

function decryptDesBlock(block: Uint8Array): Uint8Array {
  const ip = permuteBits(block, DES_IP);
  let left = ip.slice(0, 4);
  let right = ip.slice(4, 8);
  for (let round = 15; round >= 0; round -= 1) {
    const f = desFeistel(right, SAAVN_DES_SUBKEYS[round]);
    const nextRight = new Uint8Array(4);
    for (let i = 0; i < 4; i += 1) nextRight[i] = left[i] ^ f[i];
    left = right;
    right = nextRight;
  }
  const combined = new Uint8Array(8);
  combined.set(right, 0);
  combined.set(left, 4);
  return permuteBits(combined, DES_FP);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function decryptSaavnMediaUrl(encryptedMediaUrl?: string): string {
  const trimmed = String(encryptedMediaUrl || '').trim();
  if (!trimmed) return '';
  try {
    const cipherBytes = base64ToBytes(trimmed);
    if (!cipherBytes.length || cipherBytes.length % 8 !== 0) return '';
    const plain = new Uint8Array(cipherBytes.length);
    for (let offset = 0; offset < cipherBytes.length; offset += 8) {
      plain.set(decryptDesBlock(cipherBytes.subarray(offset, offset + 8)), offset);
    }
    const pad = plain[plain.length - 1];
    const end = pad >= 1 && pad <= 8 ? plain.length - pad : plain.length;
    const decoded = new TextDecoder().decode(plain.subarray(0, end)).trim();
    if (!/^https?:\/\//i.test(decoded)) return '';
    return decoded.replace(/^http:\/\//i, 'https://');
  } catch {
    return '';
  }
}

export function buildSaavnDownloadUrls(
  decryptedUrl: string,
  supports320 = true
): SaavnDownloadEntry[] {
  if (!decryptedUrl) return [];
  const qualities: Array<{ quality: string; bitrate: string }> = [
    { quality: '12kbps', bitrate: '12' },
    { quality: '48kbps', bitrate: '48' },
    { quality: '96kbps', bitrate: '96' },
    { quality: '160kbps', bitrate: '160' },
  ];
  if (supports320) qualities.push({ quality: '320kbps', bitrate: '320' });

  const bitrateRe = /_(12|48|96|160|320)(\.(?:mp4|mp3|m4a))(?:\?.*)?$/i;
  if (!bitrateRe.test(decryptedUrl)) {
    return [{ quality: supports320 ? '320kbps' : '96kbps', url: decryptedUrl }];
  }
  return qualities.map(({ quality, bitrate }) => ({
    quality,
    url: decryptedUrl.replace(bitrateRe, `_${bitrate}$2`),
  }));
}

export function buildSaavnImageList(rawImage?: string): SaavnImageEntry[] {
  const clean = String(rawImage || '').trim().replace(/^http:\/\//i, 'https://');
  if (!clean) return [];
  const sizeRe = /-(?:50x50|150x150|500x500)(\.[a-z0-9]+)$/i;
  if (!sizeRe.test(clean)) {
    return [{ quality: '500x500', url: clean }];
  }
  return [
    { quality: '50x50', url: clean.replace(sizeRe, '-50x50$1') },
    { quality: '150x150', url: clean.replace(sizeRe, '-150x150$1') },
    { quality: '500x500', url: clean.replace(sizeRe, '-500x500$1') },
  ];
}

function mapCredits(entries?: NativeSaavnArtistMapEntry[]): SaavnArtistCredit[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => ({
      id: entry.id ? String(entry.id) : undefined,
      name: entry.name ? String(entry.name) : undefined,
      role: entry.role ? String(entry.role) : undefined,
      url: entry.perma_url ? String(entry.perma_url) : undefined,
    }))
    .filter((entry) => Boolean(entry.name));
}

export function mapNativeSaavnSong(raw: NativeSaavnSongRaw): SaavnNormalizedSong | null {
  const id = String(raw.id || '').trim();
  const name = String(raw.title || raw.song || '').trim();
  const info = raw.more_info;
  if (!id || !name || !info) return null;
  if (String(info.rights?.reason || '').toLowerCase() === 'unavailable') return null;

  const decrypted = decryptSaavnMediaUrl(info.encrypted_media_url);
  if (!decrypted) return null;
  const supports320 = info['320kbps'] !== 'false' && info['320kbps'] !== false;
  const downloadUrl = buildSaavnDownloadUrls(decrypted, supports320);

  const primary = mapCredits(info.artistMap?.primary_artists);
  const featured = mapCredits(info.artistMap?.featured_artists);
  const all = mapCredits(info.artistMap?.artists);
  if (!primary.length && info.music) {
    primary.push({ name: String(info.music) });
  }

  return {
    id,
    name,
    type: raw.type || 'song',
    year: raw.year ? String(raw.year) : undefined,
    duration: Number(info.duration || 0) || 0,
    language: raw.language ? String(raw.language) : undefined,
    playCount: Number(raw.play_count || 0) || undefined,
    url: raw.perma_url ? String(raw.perma_url) : undefined,
    album: info.album
      ? {
          id: info.album_id ? String(info.album_id) : undefined,
          name: String(info.album),
          url: info.album_url ? String(info.album_url) : undefined,
        }
      : undefined,
    artists: { primary, featured, all },
    image: buildSaavnImageList(raw.image),
    downloadUrl,
  };
}

export function mapNativeSaavnAlbum(raw: NativeSaavnAlbumRaw): {
  id: string;
  name: string;
  year?: string;
  image: SaavnImageEntry[];
  url?: string;
  artists: { primary: SaavnArtistCredit[] };
} | null {
  const id = String(raw.id || '').trim();
  const name = String(raw.title || '').trim();
  if (!id || !name) return null;
  const primary = mapCredits(raw.more_info?.artistMap?.primary_artists);
  const fallbackMusic = raw.more_info?.music || raw.music;
  if (!primary.length && fallbackMusic) primary.push({ name: String(fallbackMusic) });
  return {
    id,
    name,
    year: raw.more_info?.year || raw.year,
    image: buildSaavnImageList(raw.image),
    url: raw.perma_url,
    artists: { primary },
  };
}

export function mapNativeSaavnArtist(raw: NativeSaavnArtistRaw): {
  id: string;
  name: string;
  image: SaavnImageEntry[];
  url?: string;
} | null {
  const id = String(raw.id || '').trim();
  const name = String(raw.name || raw.title || '').trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    image: buildSaavnImageList(raw.image),
    url: raw.perma_url,
  };
}
