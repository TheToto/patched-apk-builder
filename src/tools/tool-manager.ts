import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../core/context.js';
import { HttpClient } from '../core/http.js';

export class ToolManager {
  private http: HttpClient;

  constructor(private ctx: AppContext) {
    this.http = new HttpClient(this.ctx.githubToken);
  }

  public getApkSignerPath(): string {
    const localJar = path.join(this.ctx.rootDir, 'bin', 'apksigner.jar');
    if (fs.existsSync(localJar)) {
      return localJar;
    }
    return 'apksigner';
  }

  public async getApkEditorJar(): Promise<string> {
    const dest = path.join(this.ctx.toolsDir, 'apkeditor.jar');
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
      return dest;
    }

    this.ctx.log('Downloading APKEditor...');
    try {
      const release = await this.http.fetchJson<any>(
        'https://api.github.com/repos/REAndroid/APKEditor/releases/latest'
      );
      const asset = release.assets?.find((a: any) => a.name?.endsWith('.jar'));
      if (!asset?.browser_download_url) {
        throw new Error('APKEditor jar asset not found in latest release');
      }
      await this.http.downloadFile(asset.browser_download_url, dest);
      return dest;
    } catch (err: any) {
      throw new Error(`Failed to download APKEditor: ${err.message}`);
    }
  }

  public async getLsPatchJar(): Promise<string> {
    const dest = path.join(this.ctx.toolsDir, 'lspatch.jar');
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
      return dest;
    }

    this.ctx.log('Downloading LSPatch...');
    try {
      const release = await this.http.fetchJson<any>(
        'https://api.github.com/repos/JingMatrix/LSPatch/releases/latest'
      );
      const asset = release.assets?.find((a: any) => a.name?.includes('lspatch') && a.name?.endsWith('.jar'));
      if (!asset?.browser_download_url) {
        throw new Error('LSPatch jar asset not found in latest release');
      }
      await this.http.downloadFile(asset.browser_download_url, dest);
      return dest;
    } catch (err: any) {
      throw new Error(`Failed to download LSPatch: ${err.message}`);
    }
  }

  public async ensureCmprBinaries(): Promise<void> {
    const arches: Record<string, string> = {
      arm64: 'cmpr-arm64-v8a',
      arm: 'cmpr-armeabi-v7a',
      x86: 'cmpr-x86',
      x64: 'cmpr-x86_64'
    };

    for (const [folder, binaryName] of Object.entries(arches)) {
      const dest = path.join(this.ctx.moduleTemplateDir, 'bin', folder, 'cmpr');
      if (fs.existsSync(dest) && fs.statSync(dest).size > 100) {
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const url = `https://github.com/j-hc/cmpr/releases/latest/download/${binaryName}`;
      try {
        await this.http.downloadFile(url, dest);
        fs.chmodSync(dest, 0o755);
      } catch (e: any) {
        this.ctx.warn(`Could not download cmpr for ${folder}: ${e.message}`);
      }
    }
  }
}
