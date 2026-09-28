import type { ApkProvider, ApkDownloadQuery, ApkProviderResult } from '../provider.interface.js';
import { HttpClient } from '../../core/http.js';

interface GitHubAsset {
  id: number;
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  assets: GitHubAsset[];
}

export class GitHubReleaseProvider implements ApkProvider {
  public readonly name = 'github';
  private http: HttpClient;

  constructor(token?: string) {
    this.http = new HttpClient(token || process.env.GITHUB_TOKEN);
  }

  public canHandle(query: ApkDownloadQuery): boolean {
    return (
      !!query.sourceUrl &&
      (query.sourceUrl.includes('github.com') || /^[\w-]+\/[\w.-]+$/.test(query.sourceUrl))
    );
  }

  public async download(query: ApkDownloadQuery): Promise<ApkProviderResult> {
    const { owner, repo } = this.parseRepo(query.sourceUrl!);
    const release = await this.resolveRelease(owner, repo, query.version);

    const asset = this.selectBestAsset(release.assets, query.arch);
    if (!asset) {
      throw new Error(`No compatible APK asset found in release ${release.tag_name} for arch ${query.arch}`);
    }

    await this.http.downloadFile(asset.browser_download_url, query.destPath, {
      headers: {
        'User-Agent': 'ReVanced-Magisk-Module-Builder'
      }
    });

    return {
      filePath: query.destPath,
      isBundle: false,
      versionFound: release.tag_name.replace(/^v/, '')
    };
  }

  private parseRepo(urlOrRepo: string): { owner: string; repo: string } {
    const cleaned = urlOrRepo
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\/releases(\/.*)?$/, '')
      .replace(/\/+$/, '');
    const parts = cleaned.split('/');
    if (parts.length < 2) {
      throw new Error(`Invalid GitHub repository format: ${urlOrRepo}`);
    }
    return { owner: parts[0], repo: parts[1] };
  }

  private async resolveRelease(owner: string, repo: string, version: string): Promise<GitHubRelease> {
    const apiBase = `https://api.github.com/repos/${owner}/${repo}/releases`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ReVanced-Magisk-Module-Builder'
    };

    if (!version || version === 'latest' || version === 'auto') {
      try {
        const latest = await this.http.fetchJson<GitHubRelease>(`${apiBase}/latest`, { headers });
        if (latest.assets && latest.assets.some((a) => a.name.toLowerCase().endsWith('.apk'))) {
          return latest;
        }
      } catch {
        // Fallback to releases list
      }
    }

    const cleanVer = (version || '').replace(/^v/, '').trim();
    if (cleanVer && cleanVer !== 'latest' && cleanVer !== 'auto') {
      for (const tag of [`v${cleanVer}`, cleanVer]) {
        try {
          const rel = await this.http.fetchJson<GitHubRelease>(`${apiBase}/tags/${tag}`, { headers });
          if (rel.assets && rel.assets.some((a) => a.name.toLowerCase().endsWith('.apk'))) {
            return rel;
          }
        } catch {
          // Continue
        }
      }
    }

    // List recent releases and find first one matching version or having an APK
    const releases = await this.http.fetchJson<GitHubRelease[]>(`${apiBase}?per_page=30`, { headers });
    if (!Array.isArray(releases) || releases.length === 0) {
      throw new Error(`No releases found on GitHub for ${owner}/${repo}`);
    }

    if (cleanVer && cleanVer !== 'latest' && cleanVer !== 'auto') {
      const match = releases.find((r) => {
        const t = r.tag_name.replace(/^v/, '').toLowerCase();
        const n = (r.name || '').toLowerCase();
        return (
          (t === cleanVer.toLowerCase() || n.includes(cleanVer.toLowerCase())) &&
          r.assets.some((a) => a.name.toLowerCase().endsWith('.apk'))
        );
      });
      if (match) return match;
    }

    // Fallback: pick first release that has an APK
    const firstWithApk = releases.find((r) => r.assets.some((a) => a.name.toLowerCase().endsWith('.apk')));
    if (firstWithApk) return firstWithApk;

    throw new Error(`No release with APK assets found for ${owner}/${repo}`);
  }

  private selectBestAsset(assets: GitHubAsset[], arch: string): GitHubAsset | null {
    const apkAssets = assets.filter((a) => a.name.toLowerCase().endsWith('.apk'));
    if (apkAssets.length === 0) return null;

    const normalizedArch = arch === 'arm-v7a' ? 'armeabi-v7a' : arch;
    const archTokens: Record<string, string[]> = {
      'arm64-v8a': ['arm64-v8a', 'arm64', 'aarch64'],
      'armeabi-v7a': ['armeabi-v7a', 'arm-v7a', 'armv7', 'armeabi'],
      x86_64: ['x86_64', 'x64'],
      x86: ['x86']
    };

    const targetTokens = archTokens[normalizedArch] || [normalizedArch];
    const universalTokens = ['universal', 'noarch', 'all', 'fat'];

    // 1. Exact arch token match
    const archMatch = apkAssets.find((a) => {
      const lower = a.name.toLowerCase();
      return targetTokens.some((token) => lower.includes(token));
    });
    if (archMatch) return archMatch;

    // 2. Universal match
    const universalMatch = apkAssets.find((a) => {
      const lower = a.name.toLowerCase();
      return universalTokens.some((token) => lower.includes(token));
    });
    if (universalMatch) return universalMatch;

    // 3. Fallback to first available APK
    return apkAssets[0];
  }
}
