import path from 'node:path';
import * as cheerio from 'cheerio';
import type { ApkProvider, ApkDownloadQuery, ApkProviderResult } from '../provider.interface.js';
import { HttpClient } from '../../core/http.js';
import { sortVersionsDescending } from '../../core/version.js';

export class ArchiveProvider implements ApkProvider {
  public readonly name = 'archive';
  private http = new HttpClient();

  public canHandle(query: ApkDownloadQuery): boolean {
    return (
      (!!query.sourceUrl && query.sourceUrl.includes('archive.org')) ||
      (!query.sourceUrl && !!query.pkgName)
    );
  }

  public async download(query: ApkDownloadQuery): Promise<ApkProviderResult> {
    const cleanBaseUrl = (
      query.sourceUrl || `https://archive.org/download/jhc-apks/apks/${query.pkgName}`
    ).replace(/\/+$/, '');
    const html = await this.http.fetchText(`${cleanBaseUrl}/`);
    const $ = cheerio.load(html);

    const fileLinks: string[] = [];
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href && (href.endsWith('.apk') || href.endsWith('.apkm'))) {
        fileLinks.push(href.trim());
      }
    });

    if (fileLinks.length === 0) {
      throw new Error(`No APK files found on archive.org at ${cleanBaseUrl}`);
    }

    const targetArch = query.arch.replace(/\s+/g, '');
    let matchedFile: string | null = null;
    let versionFound = query.version;

    if (query.version === 'latest' || query.version === 'auto') {
      // Extract versions from file names
      const versionMap = new Map<string, string>();
      for (const f of fileLinks) {
        // e.g. com.google.android.youtube-21.16.256-arm64-v8a.apk
        const m = f.match(/-([0-9a-zA-Z._-]+)-(all|arm64-v8a|arm-v7a|armeabi-v7a|x86|x86_64)\.(apk|apkm)$/i);
        if (m && m[1]) {
          versionMap.set(m[1], f);
        }
      }
      const sortedVers = sortVersionsDescending([...versionMap.keys()]);
      if (sortedVers.length === 0) {
        throw new Error(`Could not parse any versions from archive.org at ${cleanBaseUrl}`);
      }
      versionFound = sortedVers[0];
    }

    const cleanVer = versionFound.replace(/^v/, '');

    // Look for exact arch match first, then '-all'
    const candidates = [
      `${cleanVer}-${targetArch}.`,
      `${cleanVer}-all.`
    ];
    if (targetArch === 'arm-v7a') {
      candidates.splice(1, 0, `${cleanVer}-armeabi-v7a.`);
    }

    for (const c of candidates) {
      const found = fileLinks.find((f) => f.includes(c));
      if (found) {
        matchedFile = found;
        break;
      }
    }

    if (!matchedFile) {
      // General match
      matchedFile = fileLinks.find((f) => f.includes(cleanVer)) || null;
    }

    if (!matchedFile) {
      throw new Error(
        `File for version ${versionFound} (${query.arch}) not found on archive.org: ${cleanBaseUrl}`
      );
    }

    const downloadUrl = `${cleanBaseUrl}/${matchedFile}`;
    const isBundle = matchedFile.endsWith('.apkm') || matchedFile.endsWith('.xapk');
    const targetFile = isBundle ? `${query.destPath}.apkm` : query.destPath;

    await this.http.downloadFile(downloadUrl, targetFile);

    return {
      filePath: targetFile,
      isBundle,
      versionFound
    };
  }
}
