import * as cheerio from 'cheerio';
import type { ApkProvider, ApkDownloadQuery, ApkProviderResult } from '../provider.interface.js';
import { HttpClient, USER_AGENT_BROWSER } from '../../core/http.js';

export class ApkMirrorProvider implements ApkProvider {
  public readonly name = 'apkmirror';
  private http: HttpClient;

  constructor() {
    this.http = new HttpClient();
  }

  public canHandle(query: ApkDownloadQuery): boolean {
    return (
      (!!query.sourceUrl && query.sourceUrl.includes('apkmirror.com')) ||
      (!query.sourceUrl && !!query.pkgName)
    );
  }

  public async download(query: ApkDownloadQuery): Promise<ApkProviderResult> {
    let baseUrl = query.sourceUrl ? query.sourceUrl.replace(/\/+$/, '') : '';

    // If sourceUrl is not given, search APKMirror for pkgName
    if (!baseUrl) {
      const searchUrl = `https://www.apkmirror.com/?post_type=app_release&searchtype=apk&s=${encodeURIComponent(query.pkgName)}`;
      const searchHtml = await this.http.fetchText(searchUrl);
      const $search = cheerio.load(searchHtml);
      const foundLink = $search('a.fontBlack, h5.appRowTitle a, div.appRow a').first().attr('href');
      if (foundLink) {
        // e.g. /apk/redditinc/reddit/reddit-2026-39-0-release/ -> extract base /apk/redditinc/reddit
        const match = foundLink.match(/^(\/apk\/[^/]+\/[^/]+)/);
        if (match) {
          baseUrl = `https://www.apkmirror.com${match[1]}`;
        }
      }
      if (!baseUrl) {
        throw new Error(`Could not find app page on APKMirror for ${query.pkgName}`);
      }
    }

    const appSlug = baseUrl.split('/').pop() || '';
    let releaseUrl = '';
    let versionFound = query.version;

    // If version is latest / auto / unspecified, pick the latest release on the app page
    if (!query.version || query.version === 'latest' || query.version === 'auto') {
      const baseHtml = await this.http.fetchText(baseUrl);
      const $base = cheerio.load(baseHtml);
      const firstRel = $base('a[href*="-release/"]').first().attr('href');
      if (!firstRel) {
        throw new Error(`Could not find any releases on APKMirror for ${baseUrl}`);
      }
      releaseUrl = new URL(firstRel, 'https://www.apkmirror.com').toString();
      // Extract version from releaseUrl
      const vMatch = releaseUrl.match(/-([0-9]+(?:-[0-9a-zA-Z]+)+)-release/);
      if (vMatch) {
        versionFound = vMatch[1].replace(/-/g, '.');
      }
    } else {
      const cleanVersion = query.version.replace(/-release-(?:arm64-v8a|arm-v7a|x86_64|x86|universal)$/i, '');
      const versionFormatted = cleanVersion.replace(/\s+/g, '-').replace(/\./g, '-');
      releaseUrl = `${baseUrl}/${appSlug}-${versionFormatted}-release/`;
    }

    let releaseHtml: string = '';
    try {
      releaseHtml = await this.http.fetchText(releaseUrl, {
        headers: {
          Referer: baseUrl,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });
    } catch (err: any) {
      // If failed, try discovering the full title slug (e.g. gboard -> gboard-the-google-keyboard)
      try {
        const baseHtml = await this.http.fetchText(baseUrl, {
          headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
        });
        const $base = cheerio.load(baseHtml);
        const titleText = $base('h1.marginZero, h1').first().text().trim();
        if (titleText && query.version && query.version !== 'latest' && query.version !== 'auto') {
          const cleanVersion = query.version.replace(/-release-(?:arm64-v8a|arm-v7a|x86_64|x86|universal)$/i, '');
          const versionFormatted = cleanVersion.replace(/\s+/g, '-').replace(/\./g, '-');
          const fullSlug = titleText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          releaseUrl = `${baseUrl}/${fullSlug}-${versionFormatted}-release/`;
          releaseHtml = await this.http.fetchText(releaseUrl, {
            headers: {
              Referer: baseUrl,
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
          });
        } else {
          throw err;
        }
      } catch {
        throw new Error(`APKMirror release page fetch failed for ${releaseUrl}: ${err.message}`);
      }
    }

    const $release = cheerio.load(releaseHtml);

    // Step 2: Search for compatible variant in the table
    const targetArch = query.arch === 'arm-v7a' ? 'armeabi-v7a' : query.arch;
    const compatibleArches = ['universal', 'noarch', targetArch];
    if (targetArch !== 'all') {
      compatibleArches.push('arm64-v8a + armeabi-v7a');
    }

    let downloadVariantUrl: string | null = null;
    let isBundle = false;

    // APKMirror lists variants in rows
    $release('div.table-row.headerFont').each((_, row) => {
      if (downloadVariantUrl) return;

      const rowText = $release(row).text();
      const link = $release(row).find('a.accent_color').attr('href');
      if (!link) return;

      const hasArch = compatibleArches.some((a) => rowText.toLowerCase().includes(a.toLowerCase()));
      const isApk = rowText.includes('APK');
      const isApkm = rowText.includes('BUNDLE');

      if (hasArch && (isApk || isApkm)) {
        downloadVariantUrl = new URL(link, 'https://www.apkmirror.com').toString();
        isBundle = isApkm;
      }
    });

    if (!downloadVariantUrl) {
      // Fallback: take first download button if only one variant exists
      const firstLink = $release('a.accent_color').first().attr('href');
      if (firstLink) {
        downloadVariantUrl = new URL(firstLink, 'https://www.apkmirror.com').toString();
      }
    }

    if (!downloadVariantUrl) {
      throw new Error(`No compatible variant found on APKMirror for ${query.pkgName} ${query.version}`);
    }

    // Step 3: Go to variant page to get "Download APK/BUNDLE" button
    const variantHtml = await this.http.fetchText(downloadVariantUrl, {
      headers: { Referer: releaseUrl }
    });
    const $variant = cheerio.load(variantHtml);
    const downloadPageRel = $variant('a.downloadButton, a.btn.accent_bg').attr('href');
    if (!downloadPageRel) {
      throw new Error(`Download button not found on APKMirror variant page: ${downloadVariantUrl}`);
    }
    const downloadPageUrl = new URL(downloadPageRel, 'https://www.apkmirror.com').toString();

    // Step 4: Go to direct download page to get the final download token
    const directHtml = await this.http.fetchText(downloadPageUrl, {
      headers: { Referer: downloadVariantUrl }
    });
    const $direct = cheerio.load(directHtml);
    const finalRel = $direct('span > a[rel="nofollow"]').attr('href') || $direct('a.btn.accent_bg').attr('href');
    if (!finalRel) {
      throw new Error(`Final download link not found on APKMirror page: ${downloadPageUrl}`);
    }
    const finalDownloadUrl = new URL(finalRel, 'https://www.apkmirror.com').toString();

    // Step 5: Download the APK
    const targetFile = isBundle ? `${query.destPath}.apkm` : query.destPath;
    await this.http.downloadFile(finalDownloadUrl, targetFile, {
      headers: { Referer: downloadPageUrl }
    });

    return {
      filePath: targetFile,
      isBundle,
      versionFound: query.version
    };
  }
}
