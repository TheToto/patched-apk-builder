import * as cheerio from 'cheerio';
import type { ApkProvider, ApkDownloadQuery, ApkProviderResult } from '../provider.interface.js';
import { HttpClient } from '../../core/http.js';

export class UptodownProvider implements ApkProvider {
  public readonly name = 'uptodown';
  private http = new HttpClient();

  public canHandle(query: ApkDownloadQuery): boolean {
    return !!query.sourceUrl && query.sourceUrl.includes('uptodown.com');
  }

  public async download(query: ApkDownloadQuery): Promise<ApkProviderResult> {
    if (!query.sourceUrl) {
      throw new Error('Uptodown provider requires sourceUrl');
    }

    const cleanBaseUrl = query.sourceUrl.replace(/\/+$/, '');
    // Fetch app page or versions page
    const versionsUrl = `${cleanBaseUrl}/versions`;
    const html = await this.http.fetchText(versionsUrl);
    const $ = cheerio.load(html);

    // Find version link
    let targetLink: string | null = null;
    $('div#versions-items-list div[data-url]').each((_, el) => {
      if (targetLink) return;
      const verText = $(el).find('span.version').text().trim();
      const itemUrl = $(el).attr('data-url');
      if (verText.includes(query.version) && itemUrl) {
        targetLink = itemUrl;
      }
    });

    if (!targetLink) {
      // Try download page directly
      targetLink = `${cleanBaseUrl}/download`;
    }

    const downloadPageHtml = await this.http.fetchText(targetLink);
    const $dl = cheerio.load(downloadPageHtml);
    const dataUrl = $dl('#detail-download-button').attr('data-url');
    if (!dataUrl) {
      throw new Error(`Uptodown download button data-url not found at ${targetLink}`);
    }

    const directDownloadUrl = `https://dw.uptodown.com/dwn/${dataUrl}`;
    const isBundle = dataUrl.includes('-x');
    const targetFile = isBundle ? `${query.destPath}.apkm` : query.destPath;

    await this.http.downloadFile(directDownloadUrl, targetFile);

    return {
      filePath: targetFile,
      isBundle,
      versionFound: query.version
    };
  }
}
