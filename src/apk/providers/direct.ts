import type { ApkProvider, ApkDownloadQuery, ApkProviderResult } from '../provider.interface.js';
import { HttpClient } from '../../core/http.js';

export class DirectProvider implements ApkProvider {
  public readonly name = 'direct';
  private http = new HttpClient();

  public canHandle(query: ApkDownloadQuery): boolean {
    return !!query.sourceUrl && (
      query.sourceUrl.endsWith('.apk') ||
      query.sourceUrl.endsWith('.apkm') ||
      query.sourceUrl.endsWith('.xapk') ||
      query.sourceUrl.includes('/releases/download/')
    );
  }

  public async download(query: ApkDownloadQuery): Promise<ApkProviderResult> {
    if (!query.sourceUrl) {
      throw new Error('Direct provider requires sourceUrl');
    }

    const isBundle = query.sourceUrl.endsWith('.apkm') || query.sourceUrl.endsWith('.xapk');
    const targetFile = isBundle ? `${query.destPath}.apkm` : query.destPath;

    await this.http.downloadFile(query.sourceUrl, targetFile);

    return {
      filePath: targetFile,
      isBundle,
      versionFound: query.version
    };
  }
}
