import express from 'express';
import { Readable } from 'node:stream';

const AUDIO_EXT = /\.(?:mp3|ogg|opus|m4a|flac|wav)$/i;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

type ArchiveFile = {
  name?: string;
  size?: string;
  private?: string | boolean;
  format?: string;
};

type ArchiveMetadata = {
  metadata?: {
    title?: string;
    creator?: string | string[];
    licenseurl?: string;
    runtime?: string | number;
  };
  files?: ArchiveFile[];
};

function reusableLicense(value: unknown): string | null {
  const url = String(value || '').trim();
  if (/creativecommons\.org\/publicdomain\/zero\/1\.[0-9]+\/?$/i.test(url)) return url;
  if (/creativecommons\.org\/licenses\/(?:by|by-sa)\/[0-9.]+\/?(?:[a-z-]+)?$/i.test(url)) return url;
  return null;
}

function isPublicAudioFile(file: ArchiveFile): boolean {
  const size = Number(file.size || 0);
  return Boolean(
    file.name &&
    AUDIO_EXT.test(file.name) &&
    file.private !== true &&
    file.private !== 'true' &&
    size > 0 &&
    size <= MAX_FILE_BYTES
  );
}

function safeIdentifier(value: unknown): string {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9._-]{1,120}$/.test(id) ? id : '';
}

function safeFilename(value: unknown): string {
  const name = String(value || '').trim();
  if (!name || name.length > 240 || name.includes('..') || name.startsWith('/')) return '';
  if (!AUDIO_EXT.test(name) || name.includes('\\') || name.includes('/')) return '';
  return name;
}

async function archiveJson(url: string, timeoutMs = 7000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Harmonia/1.0 (Internet Archive open-audio search)' },
    });
    if (!response.ok) throw new Error('Internet Archive request failed');
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getEligibleItem(identifier: string): Promise<{
  metadata: ArchiveMetadata;
  license: string;
  file: ArchiveFile;
} | null> {
  const data = (await archiveJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`)) as ArchiveMetadata;
  const license = reusableLicense(data.metadata?.licenseurl);
  if (!license) return null;
  const file = (data.files || []).filter(isPublicAudioFile).sort((a, b) => {
    const rank = (name: string) => /\.mp3$/i.test(name) ? 0 : /\.m4a$/i.test(name) ? 1 : /\.ogg$/i.test(name) ? 2 : 3;
    return rank(String(a.name || '')) - rank(String(b.name || ''));
  })[0];
  if (!file) return null;
  return { metadata: data, license, file };
}

export function createArchiveDownloadsRouter() {
  const router = express.Router();

  router.get('/search', async (req, res) => {
    const query = String(req.query.q || '').trim().slice(0, 100);
    if (query.length < 2) {
      res.status(400).json({ ok: false, error: 'Enter at least two characters.' });
      return;
    }
    const safeTerms = query
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 8)
      .map((term) => `"${term}"`)
      .join(' AND ');
    if (!safeTerms) {
      res.status(400).json({ ok: false, error: 'Search contains no usable terms.' });
      return;
    }
    try {
      const searchUrl = new URL('https://archive.org/advancedsearch.php');
      searchUrl.searchParams.set('q', `mediatype:audio AND title:(${safeTerms})`);
      for (const field of ['identifier', 'title', 'creator', 'licenseurl']) {
        searchUrl.searchParams.append('fl[]', field);
      }
      searchUrl.searchParams.set('rows', '16');
      searchUrl.searchParams.set('page', '1');
      searchUrl.searchParams.set('output', 'json');
      const search = await archiveJson(searchUrl.toString());
      const docs = (search?.response?.docs || []) as Array<{
        identifier?: string;
        title?: string;
        creator?: string | string[];
      }>;
      const results = await Promise.all(docs.slice(0, 12).map(async (doc) => {
        const identifier = safeIdentifier(doc.identifier);
        if (!identifier) return null;
        try {
          const eligible = await getEligibleItem(identifier);
          if (!eligible) return null;
          const creator = Array.isArray(eligible.metadata.metadata?.creator)
            ? eligible.metadata.metadata?.creator.join(', ')
            : String(eligible.metadata.metadata?.creator || (Array.isArray(doc.creator) ? doc.creator.join(', ') : doc.creator || 'Unknown creator'));
          return {
            identifier,
            title: String(eligible.metadata.metadata?.title || doc.title || identifier).slice(0, 180),
            creator: creator.slice(0, 180),
            license: eligible.license,
            fileName: String(eligible.file.name),
            size: Number(eligible.file.size || 0),
            detailUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
          };
        } catch {
          return null;
        }
      }));
      res.setHeader('Cache-Control', 'public, max-age=120');
      res.json({ ok: true, results: results.filter(Boolean) });
    } catch {
      res.status(502).json({ ok: false, error: 'Internet Archive search is temporarily unavailable.' });
    }
  });

  router.get('/download', async (req, res) => {
    const identifier = safeIdentifier(req.query.id);
    const fileName = safeFilename(req.query.file);
    if (!identifier || !fileName) {
      res.status(400).json({ ok: false, error: 'Invalid archive item or audio filename.' });
      return;
    }
    try {
      const eligible = await getEligibleItem(identifier);
      const requestedFile = (eligible?.metadata.files || []).find(
        (file) => file.name === fileName && isPublicAudioFile(file)
      );
      if (!eligible || !requestedFile) {
        res.status(403).json({ ok: false, error: 'This file is not listed as an eligible public audio download.' });
        return;
      }
      const upstreamUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${fileName.split('/').map(encodeURIComponent).join('/')}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25_000);
      let upstream: Response;
      try {
        upstream = await fetch(upstreamUrl, { signal: controller.signal, redirect: 'follow' });
      } finally {
        clearTimeout(timer);
      }
      if (!upstream.ok || !upstream.body) {
        res.status(502).json({ ok: false, error: 'Internet Archive did not provide this file for download.' });
        return;
      }
      const contentLength = Number(upstream.headers.get('content-length') || requestedFile.size || 0);
      if (contentLength > MAX_FILE_BYTES) {
        res.status(413).json({ ok: false, error: 'This audio file is larger than Harmonia’s 100 MB download limit.' });
        return;
      }
      const extension = fileName.split('.').pop()?.toLowerCase() || 'mp3';
      const mime = extension === 'flac' ? 'audio/flac' : extension === 'wav' ? 'audio/wav' :
        extension === 'ogg' || extension === 'opus' ? 'audio/ogg' :
        extension === 'm4a' ? 'audio/mp4' : 'audio/mpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/["\\\\]/g, '_')}"`);
      res.setHeader('X-Harmonia-License', eligible.license);
      res.setHeader('Cache-Control', 'no-store');
      if (contentLength > 0) res.setHeader('Content-Length', String(contentLength));
      const stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
      res.on('close', () => stream.destroy());
      stream.on('error', () => { if (!res.headersSent) res.status(502); res.end(); });
      stream.pipe(res);
    } catch {
      if (!res.headersSent) res.status(502).json({ ok: false, error: 'Download failed. Please try again.' });
      else res.end();
    }
  });

  return router;
}
