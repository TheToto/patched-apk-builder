import * as cheerio from 'cheerio';
import type { ApkProvider, ApkDownloadQuery, ApkProviderResult } from '../provider.interface.js';
import { HttpClient, USER_AGENT_BROWSER } from '../../core/http.js';

export class ApkComboProvider implements ApkProvider {
  public readonly name = 'apkcombo';
  private http = new HttpClient();

  public canHandle(query: ApkDownloadQuery): boolean {
    return (
      (!!query.sourceUrl && query.sourceUrl.includes('apkcombo.com')) ||
      (!query.sourceUrl && !!query.pkgName)
    );
  }

  public async download(query: ApkDownloadQuery): Promise<ApkProviderResult> {
    const downloadPageUrl = query.sourceUrl
      ? (query.sourceUrl.endsWith('/download/apk') ? query.sourceUrl : `${query.sourceUrl.replace(/\/+$/, '')}/download/apk`)
      : `https://apkcombo.com/app/${encodeURIComponent(query.pkgName)}/download/apk`;

    const headers = {
      'User-Agent': USER_AGENT_BROWSER,
      Referer: 'https://apkcombo.com/',
      'Accept-Language': 'en-US,en;q=0.9'
    };

    const html = await this.http.fetchText(downloadPageUrl, { headers });
    const $ = cheerio.load(html);

    const targetArch = query.arch === 'arm-v7a' ? 'armeabi-v7a' : query.arch;
    const compatibleArches = ['universal', 'noarch', targetArch];

    let downloadUrl: string | null = null;
    let isBundle = false;
    let versionFound = query.version;

    // Search through variant list items
    $('.file-list li, .variant-list li, .accordion-item').each((_, item) => {
      if (downloadUrl) return;

      const itemText = $(item).text().toLowerCase();
      const link = $(item).find('a.variant, a.download-btn, a[href*="download"]').attr('href');
      if (!link) return;

      const matchesArch = compatibleArches.some((a) => itemText.includes(a.toLowerCase()));
      const isApk = itemText.includes('apk') && !itemText.includes('xapk') && !itemText.includes('apks');
      const isXapk = itemText.includes('xapk') || itemText.includes('apks');

      if (matchesArch && (isApk || isXapk)) {
        downloadUrl = new URL(link, 'https://apkcombo.com').toString();
        isBundle = isXapk;
        const verText = $(item).find('.vername').text().trim();
        if (verText) {
          versionFound = verText.replace(/^[a-zA-Z\s]+/, '').trim();
        }
      }
    });

    // Fallback: first available download link
    if (!downloadUrl) {
      const firstLink = $('a.variant, a.download-btn, ul.file-list a').first().attr('href');
      if (firstLink) {
        downloadUrl = new URL(firstLink, 'https://apkcombo.com').toString();
        const verText = $('.vername').first().text().trim();
        if (verText) {
          versionFound = verText.replace(/^[a-zA-Z\s]+/, '').trim();
        }
      }
    }

    if (!downloadUrl) {
      throw new Error(`Failed to locate download link on APKCombo page: ${downloadPageUrl}`);
    }

    // Unpack /r2?u= redirect target directly if present
    if (downloadUrl.includes('/r2?u=')) {
      try {
        const u = new URL(downloadUrl);
        const directU = u.searchParams.get('u');
        if (directU) {
          downloadUrl = directU;
        }
      } catch {
        // keep downloadUrl
      }
    }

    const targetFile = isBundle ? `${query.destPath}.xapk` : query.destPath;
    await this.http.downloadFile(downloadUrl, targetFile, {
      headers: {
        'User-Agent': USER_AGENT_BROWSER
      }
    });

    return {
      filePath: targetFile,
      isBundle,
      versionFound
    };
  }
}
