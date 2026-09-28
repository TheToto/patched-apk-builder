import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { AppConfig, ConcreteArch } from '../core/types.js';
import type { AppContext } from '../core/context.js';
import type { ApkProvider, ApkProviderResult } from './provider.interface.js';
import { ArchiveProvider } from './providers/archive.js';
import { ApkMirrorProvider } from './providers/apkmirror.js';
import { UptodownProvider } from './providers/uptodown.js';
import { DirectProvider } from './providers/direct.js';
import { AptoideProvider } from './providers/aptoide.js';
import { ApkPureProvider } from './providers/apkpure.js';
import { ApkComboProvider } from './providers/apkcombo.js';
import { GitHubReleaseProvider } from './providers/github.js';
import { ApkEditor } from '../tools/apk-editor.js';
import { ApkSigner } from '../tools/apk-signer.js';

export class ApkResolver {
  private providers: ApkProvider[];
  private apkEditor: ApkEditor;
  private signer: ApkSigner;

  constructor(private ctx: AppContext) {
    this.providers = [
      new ArchiveProvider(),
      new GitHubReleaseProvider(),
      new AptoideProvider(),
      new ApkMirrorProvider(),
      new ApkPureProvider(),
      new ApkComboProvider(),
      new UptodownProvider(),
      new DirectProvider()
    ];
    this.apkEditor = new ApkEditor(this.ctx);
    this.signer = new ApkSigner(this.ctx);
  }

  public async acquireStockApk(
    app: AppConfig,
    targetVersion: string,
    arch: ConcreteArch,
    pkgName: string
  ): Promise<string> {
    const cleanVer = targetVersion.replace(/\s+/g, '-').replace(/^v/, '');
    const cleanArch = arch.replace(/\s+/g, '-');
    const finalStockApk = path.join(this.ctx.tempDir, `${pkgName}-${cleanVer}-${cleanArch}.apk`);

    // If already downloaded and verified in temp, reuse it
    if (fs.existsSync(finalStockApk) && fs.statSync(finalStockApk).size > 50000) {
      return finalStockApk;
    }

    // List sources to try in priority order:
    const sourcesToTry: Array<{ url: string; providerName?: string }> = [];
    if (app.githubDlurl) sourcesToTry.push({ url: app.githubDlurl, providerName: 'github' });
    if (app.archiveDlurl) sourcesToTry.push({ url: app.archiveDlurl, providerName: 'archive' });
    if (app.apkmirrorDlurl) sourcesToTry.push({ url: app.apkmirrorDlurl, providerName: 'apkmirror' });
    if (app.apkpureDlurl) sourcesToTry.push({ url: app.apkpureDlurl, providerName: 'apkpure' });
    if (app.aptoideDlurl) sourcesToTry.push({ url: app.aptoideDlurl, providerName: 'aptoide' });
    if (app.apkcomboDlurl) sourcesToTry.push({ url: app.apkcomboDlurl, providerName: 'apkcombo' });
    if (app.uptodownDlurl) sourcesToTry.push({ url: app.uptodownDlurl, providerName: 'uptodown' });
    if (app.directDlurl) sourcesToTry.push({ url: app.directDlurl, providerName: 'direct' });

    if (sourcesToTry.length === 0) {
      throw new Error(`No download URL configured for app: ${app.name} (${app.slug})`);
    }

    let downloadResult: ApkProviderResult | null = null;
    let lastError: Error | null = null;

    for (const source of sourcesToTry) {
      const provider = this.providers.find((p) =>
        source.providerName ? p.name === source.providerName : p.canHandle({
          pkgName,
          version: targetVersion,
          arch,
          destPath: finalStockApk,
          sourceUrl: source.url
        })
      );

      if (!provider) continue;

      this.ctx.log(`Attempting to download ${app.name} (${targetVersion}) from ${provider.name}...`);
      try {
        downloadResult = await provider.download({
          pkgName,
          version: targetVersion,
          arch,
          dpi: app.dpi,
          destPath: finalStockApk,
          sourceUrl: source.url
        });
        break;
      } catch (err: any) {
        this.ctx.warn(`Download failed from ${provider.name}: ${err.message}`);
        lastError = err;
      }
    }

    if (!downloadResult || !fs.existsSync(downloadResult.filePath)) {
      throw new Error(
        `Failed to acquire APK for ${app.name} (${targetVersion}): ${lastError?.message || 'No source succeeded'}`
      );
    }

    // If it's a split APK bundle (.apkm / .xapk), verify base.apk first then merge
    if (downloadResult.isBundle) {
      const bundlePath = downloadResult.filePath;
      const zip = new AdmZip(bundlePath);
      const baseEntry = zip.getEntry('base.apk') || zip.getEntries().find((e: any) => e.entryName.endsWith('base.apk') || e.entryName.endsWith('.apk'));
      if (!baseEntry) {
        throw new Error(`No base.apk found in bundle ${bundlePath}`);
      }

      const tempBaseApk = `${finalStockApk}.verify-base.apk`;
      fs.writeFileSync(tempBaseApk, baseEntry.getData());
      try {
        const sigValid = await this.signer.verifySignatureAgainstSigTxt(tempBaseApk, pkgName);
        if (!sigValid) {
          throw new Error(`Signature verification failed for ${app.name} bundle (${bundlePath})`);
        }
      } finally {
        if (fs.existsSync(tempBaseApk)) {
          try {
            fs.unlinkSync(tempBaseApk);
          } catch {
            // ignore
          }
        }
      }

      // Merge bundle into finalStockApk
      await this.apkEditor.mergeBundle(bundlePath, finalStockApk);
    } else {
      // Verify official signature directly on downloaded APK
      const sigValid = await this.signer.verifySignatureAgainstSigTxt(finalStockApk, pkgName);
      if (!sigValid) {
        fs.unlinkSync(finalStockApk);
        throw new Error(`Signature verification failed for ${app.name} (${finalStockApk})`);
      }
    }

    return finalStockApk;
  }
}
