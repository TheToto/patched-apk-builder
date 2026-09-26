import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../core/context.js';
import { HttpClient } from '../core/http.js';

export interface ReleaseAssetInfo {
  tag: string;
  assetName: string;
  filePath: string;
}

export class ReleaseFetcher {
  private http: HttpClient;

  constructor(private ctx: AppContext) {
    this.http = new HttpClient(this.ctx.githubToken);
  }

  private getReleaseApiUrl(source: string): { baseUrl: string; isCodeberg: boolean } {
    if (source.includes('codeberg.org')) {
      const cleanRepo = source.replace(/.*codeberg\.org\//, '').replace(/^\/+/, '');
      return {
        baseUrl: `https://codeberg.org/api/v1/repos/${cleanRepo}/releases`,
        isCodeberg: true
      };
    }
    const cleanRepo = source.replace(/^https?:\/\/[^\/]+\//, '').replace(/^\/+/, '');
    return {
      baseUrl: `https://api.github.com/repos/${cleanRepo}/releases`,
      isCodeberg: false
    };
  }

  public async fetchRelease(
    source: string,
    versionTag: string = 'latest'
  ): Promise<{ tag: string; assets: Array<{ name: string; browser_download_url: string }> }> {
    const { baseUrl } = this.getReleaseApiUrl(source);

    let releaseUrl = baseUrl;
    if (versionTag === 'dev') {
      releaseUrl = baseUrl; // Will take first item
    } else if (versionTag === 'latest') {
      releaseUrl = `${baseUrl}/latest`;
    } else {
      releaseUrl = `${baseUrl}/tags/${versionTag}`;
    }

    try {
      const resp = await this.http.fetchJson<any>(releaseUrl);
      const release = Array.isArray(resp) ? resp[0] : resp;
      if (!release || !release.tag_name) {
        throw new Error(`Invalid release object received from ${releaseUrl}`);
      }
      return {
        tag: release.tag_name,
        assets: release.assets || []
      };
    } catch (err: any) {
      // Fallback: If /latest fails (e.g. repo only has prereleases), try listing all releases
      if (versionTag === 'latest') {
        const allReleases = await this.http.fetchJson<any[]>(baseUrl);
        if (Array.isArray(allReleases) && allReleases.length > 0) {
          const first = allReleases[0];
          return {
            tag: first.tag_name,
            assets: first.assets || []
          };
        }
      }
      throw new Error(`Failed to fetch release for ${source} (${versionTag}): ${err.message}`);
    }
  }

  public async getPatchesBundle(
    source: string,
    versionTag: string = 'latest'
  ): Promise<ReleaseAssetInfo> {
    const release = await this.fetchRelease(source, versionTag);
    const asset = release.assets.find((a) => {
      const name = a.name.toLowerCase();
      return (
        (name.endsWith('.jar') || name.endsWith('.mpp') || name.endsWith('.zip') || name.endsWith('.apk')) &&
        !name.endsWith('.asc') &&
        !name.endsWith('.json') &&
        !name.endsWith('.sig') &&
        !name.includes('sources')
      );
    });

    if (!asset) {
      throw new Error(`No compatible patch bundle found in ${source} release ${release.tag}`);
    }

    const ext = path.extname(asset.name) || '.jar';
    const slug = source.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dest = path.join(this.ctx.tempDir, 'patches', `${slug}-${release.tag}${ext}`);

    if (!fs.existsSync(dest) || fs.statSync(dest).size < 1000) {
      this.ctx.log(`Downloading patches from ${source} (${release.tag})...`);
      await this.http.downloadFile(asset.browser_download_url, dest);
    }

    return {
      tag: release.tag,
      assetName: asset.name,
      filePath: dest
    };
  }

  public async getCliJar(source: string, versionTag: string = 'latest'): Promise<ReleaseAssetInfo> {
    const release = await this.fetchRelease(source, versionTag);
    const asset = release.assets.find((a) => {
      const name = a.name.toLowerCase();
      return (
        name.endsWith('.jar') &&
        !name.endsWith('.asc') &&
        !name.includes('sources') &&
        !name.includes('javadoc')
      );
    });

    if (!asset) {
      throw new Error(`No CLI jar asset found in ${source} release ${release.tag}`);
    }

    const slug = source.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dest = path.join(this.ctx.toolsDir, `${slug}-${release.tag}.jar`);

    if (!fs.existsSync(dest) || fs.statSync(dest).size < 1000) {
      this.ctx.log(`Downloading CLI from ${source} (${release.tag})...`);
      await this.http.downloadFile(asset.browser_download_url, dest);
    }

    return {
      tag: release.tag,
      assetName: asset.name,
      filePath: dest
    };
  }

  public async getAssetByPattern(
    source: string,
    pattern: RegExp | string,
    versionTag: string = 'latest'
  ): Promise<ReleaseAssetInfo> {
    const release = await this.fetchRelease(source, versionTag);
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    const asset = release.assets.find((a) => regex.test(a.name));

    if (!asset) {
      throw new Error(
        `Asset matching pattern '${pattern}' not found in ${source} release ${release.tag}`
      );
    }

    const slug = source.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dest = path.join(this.ctx.tempDir, `${slug}-${release.tag}-${asset.name}`);

    if (!fs.existsSync(dest) || fs.statSync(dest).size < 1000) {
      this.ctx.log(`Downloading asset ${asset.name} from ${source}...`);
      await this.http.downloadFile(asset.browser_download_url, dest);
    }

    return {
      tag: release.tag,
      assetName: asset.name,
      filePath: dest
    };
  }
}
