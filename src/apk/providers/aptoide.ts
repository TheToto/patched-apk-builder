import crypto from 'node:crypto';
import fs from 'node:fs';
import type { ApkProvider, ApkDownloadQuery, ApkProviderResult } from '../provider.interface.js';
import { HttpClient, USER_AGENT_BROWSER } from '../../core/http.js';

export class AptoideProvider implements ApkProvider {
  public readonly name = 'aptoide';
  private http = new HttpClient();

  public canHandle(query: ApkDownloadQuery): boolean {
    return (
      (!!query.sourceUrl && query.sourceUrl.includes('aptoide.com')) ||
      (!query.sourceUrl && !!query.pkgName)
    );
  }

  public async download(query: ApkDownloadQuery): Promise<ApkProviderResult> {
    const pkg = query.pkgName;
    const apiUrl = `https://ws75.aptoide.com/api/7/app/get?package_name=${encodeURIComponent(pkg)}`;

    const response = await this.http.fetchJson<any>(apiUrl, {
      headers: {
        'User-Agent': USER_AGENT_BROWSER,
        Accept: 'application/json'
      }
    });

    if (response?.info?.status !== 'OK') {
      const err = response?.info?.errors?.[0]?.msg || 'Unknown Aptoide error';
      throw new Error(`Aptoide API error for ${pkg}: ${err}`);
    }

    const appData = response?.nodes?.meta?.data;
    if (!appData || !appData.file) {
      throw new Error(`No file data found on Aptoide for ${pkg}`);
    }

    const file = appData.file;

    // Safety verification: only proceed with TRUSTED ranked apps
    if (file.malware?.rank && file.malware.rank !== 'TRUSTED') {
      throw new Error(`Aptoide app ${pkg} verification rank is not TRUSTED (rank: ${file.malware.rank})`);
    }

    // Architecture compatibility check
    const targetArch = query.arch === 'arm-v7a' ? 'armeabi-v7a' : query.arch;
    if (targetArch !== 'all' && file.hardware?.cpus && Array.isArray(file.hardware.cpus) && file.hardware.cpus.length > 0) {
      const isCompat = file.hardware.cpus.some(
        (c: string) =>
          c.toLowerCase() === targetArch.toLowerCase() ||
          c.toLowerCase() === 'universal' ||
          c.toLowerCase() === 'noarch'
      );
      if (!isCompat) {
        throw new Error(
          `Aptoide APK does not support requested arch ${targetArch} (supported: ${file.hardware.cpus.join(', ')})`
        );
      }
    }

    const downloadUrl = file.path || file.path_alt;
    if (!downloadUrl) {
      throw new Error(`No download path available from Aptoide for ${pkg}`);
    }

    await this.http.downloadFile(downloadUrl, query.destPath, {
      headers: {
        'User-Agent': USER_AGENT_BROWSER
      }
    });

    // Integrity verification via MD5
    if (file.md5sum && fs.existsSync(query.destPath)) {
      const hash = crypto.createHash('md5');
      hash.update(fs.readFileSync(query.destPath));
      const computedMd5 = hash.digest('hex');
      if (computedMd5.toLowerCase() !== file.md5sum.toLowerCase()) {
        fs.unlinkSync(query.destPath);
        throw new Error(`MD5 integrity mismatch for ${pkg}. Expected: ${file.md5sum}, Got: ${computedMd5}`);
      }
    }

    return {
      filePath: query.destPath,
      isBundle: false,
      versionFound: file.vername || query.version
    };
  }
}
