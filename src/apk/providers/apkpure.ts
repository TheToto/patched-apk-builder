import * as cheerio from 'cheerio';
import type { ApkProvider, ApkDownloadQuery, ApkProviderResult } from '../provider.interface.js';
import { HttpClient, USER_AGENT_BROWSER } from '../../core/http.js';

export class ApkPureProvider implements ApkProvider {
  public readonly name = 'apkpure';
  private http: HttpClient;

  constructor() {
    this.http = new HttpClient();
  }

  public canHandle(query: ApkDownloadQuery): boolean {
    return (
      (!!query.sourceUrl && query.sourceUrl.includes('apkpure.com')) ||
      (!query.sourceUrl && !!query.pkgName)
    );
  }

  public async download(query: ApkDownloadQuery): Promise<ApkProviderResult> {
    const pkg = query.pkgName;
    const isLatest = !query.version || query.version === 'latest' || query.version === 'auto';

    let downloadUrl: string;
    let isBundle = false;

    if (isLatest) {
      downloadUrl = `https://d.apkpure.com/b/APK/${encodeURIComponent(pkg)}?version=latest`;
    } else {
      const versionCode = await this.resolveVersionCode(query);
      if (versionCode) {
        downloadUrl = `https://d.apkpure.com/b/APK/${encodeURIComponent(pkg)}?versionCode=${versionCode}`;
      } else {
        downloadUrl = `https://d.apkpure.com/b/APK/${encodeURIComponent(pkg)}?version=latest`;
      }
    }

    const headers = {
      'User-Agent': USER_AGENT_BROWSER,
      Referer: 'https://apkpure.com/',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    };

    // Check if APK is available or if we should fallback to XAPK
    try {
      const headRes = await fetch(downloadUrl, { method: 'HEAD', headers, redirect: 'follow' });
      if (!headRes.ok && (headRes.status === 404 || headRes.status === 403)) {
        downloadUrl = downloadUrl.replace('/b/APK/', '/b/XAPK/');
        isBundle = true;
      } else {
        const disposition = headRes.headers.get('content-disposition') || '';
        if (disposition.includes('.xapk') || disposition.includes('.apkm')) {
          isBundle = true;
        }
      }
    } catch {
      // Proceed with initial downloadUrl
    }

    const targetFile = isBundle ? `${query.destPath}.xapk` : query.destPath;
    await this.http.downloadFile(downloadUrl, targetFile, { headers });

    return {
      filePath: targetFile,
      isBundle,
      versionFound: query.version
    };
  }

  private async resolveVersionCode(query: ApkDownloadQuery): Promise<string | null> {
    let versionsUrl = query.sourceUrl
      ? `${query.sourceUrl.replace(/\/+$/, '')}/versions`
      : '';

    if (!versionsUrl) {
      try {
        const searchHtml = await this.http.fetchText(
          `https://apkpure.com/search?q=${encodeURIComponent(query.pkgName)}`,
          {
            headers: {
              'User-Agent': USER_AGENT_BROWSER,
              Referer: 'https://apkpure.com/'
            }
          }
        );
        const $s = cheerio.load(searchHtml);
        const matchHref = $s(`a[href*="/${query.pkgName}"]`).first().attr('href');
        if (matchHref) {
          const baseAppUrl = matchHref.startsWith('http') ? matchHref : `https://apkpure.com${matchHref}`;
          versionsUrl = `${baseAppUrl.replace(/\/+$/, '')}/versions`;
        }
      } catch {
        // fallback below
      }
    }

    if (!versionsUrl) {
      versionsUrl = `https://apkpure.com/${query.pkgName}/versions`;
    }

    try {
      const html = await this.http.fetchText(versionsUrl, {
        headers: {
          'User-Agent': USER_AGENT_BROWSER,
          Referer: 'https://apkpure.com/'
        }
      });
      const $ = cheerio.load(html);

      let matchedVersionCode: string | null = null;
      const cleanTargetVer = query.version.trim().toLowerCase().replace(/^v/, '');

      $('ul.ver-wrap li, div.ver-item').each((_, el) => {
        if (matchedVersionCode) return;
        const verText = $(el).find('span.ver-item-n, span.version').text().trim().toLowerCase();
        if (verText.includes(cleanTargetVer)) {
          const vcode = $(el).attr('data-dt-vcode') || $(el).find('a').attr('data-dt-vcode');
          if (vcode) {
            matchedVersionCode = vcode;
            return;
          }
          const href = $(el).find('a').attr('href') || '';
          const match = href.match(/\/download\/(\d+)-(?:APK|XAPK)/i);
          if (match) {
            matchedVersionCode = match[1];
          }
        }
      });

      return matchedVersionCode;
    } catch {
      return null;
    }
  }
}
