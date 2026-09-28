import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { AppConfig, ConcreteArch, FullConfig } from '../core/types.js';
import type { AppContext } from '../core/context.js';
import type { ApkProvider, ApkProviderResult } from './provider.interface.js';
import { inferPackageName } from '../core/pkg.js';
import { ArchiveProvider } from './providers/archive.js';
import { ApkMirrorProvider } from './providers/apkmirror.js';
import { UptodownProvider } from './providers/uptodown.js';
import { DirectProvider } from './providers/direct.js';
import { AptoideProvider } from './providers/aptoide.js';
import { ApkPureProvider } from './providers/apkpure.js';
import { ApkComboProvider } from './providers/apkcombo.js';
import { GitHubReleaseProvider } from './providers/github.js';
import { HttpClient } from '../core/http.js';
import { sortVersionsDescending } from '../core/version.js';
import { ApkEditor } from '../tools/apk-editor.js';
import { ApkSigner } from '../tools/apk-signer.js';

export interface AvailableVersionInfo {
  version: string;
  sources: string[];
  isPatchesCompatible?: boolean;
}

export interface StandaloneDownloadOptions {
  appNameOrSlug: string;
  config?: FullConfig;
  version?: string;
  arch?: ConcreteArch;
  providerName?: string;
  outDir?: string;
  tryAll?: boolean;
  verifySignature?: boolean;
}

export interface StandaloneDownloadResult {
  provider: string;
  success: boolean;
  versionFound?: string;
  filePath?: string;
  fileSize?: number;
  isBundle?: boolean;
  signatureValid?: boolean;
  certSha256?: string;
  error?: string;
}

export class ApkResolver {
  private providers: ApkProvider[];
  private apkEditor: ApkEditor;
  private signer: ApkSigner;
  private http: HttpClient;

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
    this.http = new HttpClient();
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

    // Universal fallbacks for apps with standard package names:
    if (!app.aptoideDlurl) sourcesToTry.push({ url: '', providerName: 'aptoide' });
    if (!app.apkpureDlurl) sourcesToTry.push({ url: '', providerName: 'apkpure' });
    if (!app.apkcomboDlurl) sourcesToTry.push({ url: '', providerName: 'apkcombo' });

    if (sourcesToTry.length === 0) {
      throw new Error(`No download URL or compatible provider found for app: ${app.name} (${app.slug})`);
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

  public async downloadStandaloneApk(
    opts: StandaloneDownloadOptions
  ): Promise<StandaloneDownloadResult[]> {
    const target = opts.appNameOrSlug.trim();
    const app = opts.config
      ? Object.values(opts.config.apps).find((a) => {
          const lower = target.toLowerCase();
          return (
            a.slug.toLowerCase() === lower ||
            a.name.toLowerCase() === lower ||
            inferPackageName(a).toLowerCase() === lower
          );
        })
      : undefined;

    const syntheticApp: AppConfig = {
      name: target,
      slug: target.toLowerCase(),
      enabled: true,
      rvBrand: 'Morphe',
      buildMode: 'both',
      patchMethod: 'revanced',
      version: opts.version || 'latest',
      arch: opts.arch || 'arm64-v8a',
      patchesSource: '',
      patchesVersion: 'latest',
      cliSource: '',
      cliVersion: 'latest',
      exclusivePatches: false,
      includeStock: 'merged',
      enableUpdateChecks: true
    };

    const pkgName = target.includes('.')
      ? target
      : app
        ? inferPackageName(app)
        : inferPackageName(syntheticApp);

    const targetVersion = (opts.version || app?.version || 'latest').trim();
    const targetArch = (opts.arch || (app?.arch && app.arch !== 'both' ? app.arch : 'arm64-v8a')) as ConcreteArch;
    const outDir = opts.outDir || path.join(this.ctx.rootDir, 'temp', 'downloads');
    fs.mkdirSync(outDir, { recursive: true });

    const providerUrls: Record<string, string | undefined> = {
      github: app?.githubDlurl,
      archive: app?.archiveDlurl,
      apkmirror: app?.apkmirrorDlurl,
      apkpure: app?.apkpureDlurl,
      aptoide: app?.aptoideDlurl,
      apkcombo: app?.apkcomboDlurl,
      uptodown: app?.uptodownDlurl,
      direct: app?.directDlurl
    };

    let targetProviders: ApkProvider[] = [];
    if (opts.providerName) {
      const p = this.providers.find(
        (prov) => prov.name.toLowerCase() === opts.providerName!.toLowerCase()
      );
      if (!p) {
        throw new Error(
          `Unknown provider: ${opts.providerName}. Available: ${this.providers.map((pr) => pr.name).join(', ')}`
        );
      }
      targetProviders = [p];
    } else {
      targetProviders = this.providers.filter((p) =>
        p.canHandle({
          pkgName,
          version: targetVersion,
          arch: targetArch,
          destPath: '',
          sourceUrl: providerUrls[p.name]
        })
      );
    }

    if (targetProviders.length === 0) {
      throw new Error(`No compatible provider found for app: ${opts.appNameOrSlug} (${pkgName})`);
    }

    const results: StandaloneDownloadResult[] = [];
    const cleanVer = targetVersion.replace(/\s+/g, '-').replace(/^v/, '');
    const cleanArch = targetArch.replace(/\s+/g, '-');

    for (const provider of targetProviders) {
      this.ctx.log(
        `[Download] Querying ${provider.name} for ${pkgName} (v: ${targetVersion}, arch: ${targetArch})...`
      );
      const baseDestPath = path.join(outDir, `${pkgName}-${cleanVer}-${provider.name}-${cleanArch}.apk`);

      try {
        const dlResult = await provider.download({
          pkgName,
          version: targetVersion,
          arch: targetArch,
          dpi: app?.dpi,
          destPath: baseDestPath,
          sourceUrl: providerUrls[provider.name]
        });

        if (!fs.existsSync(dlResult.filePath)) {
          throw new Error(`Downloaded file not found at ${dlResult.filePath}`);
        }

        const fileSize = fs.statSync(dlResult.filePath).size;
        let signatureValid: boolean | undefined = undefined;
        let certSha256: string | undefined = undefined;

        let isBundle = dlResult.isBundle;
        let baseEntry: any = null;
        let zip: AdmZip | null = null;

        try {
          zip = new AdmZip(dlResult.filePath);
          const apkEntries = zip.getEntries().filter((e) => e.entryName.endsWith('.apk'));
          if (apkEntries.length > 1 || zip.getEntry('base.apk') || dlResult.filePath.endsWith('.xapk') || dlResult.filePath.endsWith('.apkm')) {
            isBundle = true;
            baseEntry =
              zip.getEntry('base.apk') ||
              apkEntries.find((e) => !e.entryName.startsWith('config.')) ||
              apkEntries[0];
          }
        } catch {
          // not a zip file or cannot inspect
        }

        if (opts.verifySignature !== false) {
          if (isBundle && baseEntry && zip) {
            const tempBase = `${dlResult.filePath}.verify-base.apk`;
            fs.writeFileSync(tempBase, baseEntry.getData());
            try {
              certSha256 = (await this.signer.getCertSha256(tempBase)) || undefined;
              signatureValid = await this.signer.verifySignatureAgainstSigTxt(tempBase, pkgName);
            } finally {
              if (fs.existsSync(tempBase)) {
                try {
                  fs.unlinkSync(tempBase);
                } catch {}
              }
            }
          } else {
            certSha256 = (await this.signer.getCertSha256(dlResult.filePath)) || undefined;
            signatureValid = await this.signer.verifySignatureAgainstSigTxt(dlResult.filePath, pkgName);
          }
        }

        const record: StandaloneDownloadResult = {
          provider: provider.name,
          success: true,
          versionFound: dlResult.versionFound,
          filePath: dlResult.filePath,
          fileSize,
          isBundle,
          signatureValid,
          certSha256
        };

        results.push(record);
        this.ctx.success(
          `[Download] ✓ ${provider.name} succeeded (${(fileSize / (1024 * 1024)).toFixed(2)} MB, version: ${dlResult.versionFound})`
        );

        if (!opts.tryAll) {
          break;
        }
      } catch (err: any) {
        this.ctx.warn(`[Download] ✗ ${provider.name} failed: ${err.message}`);
        results.push({
          provider: provider.name,
          success: false,
          error: err.message
        });
      }
    }

    return results;
  }

  public async getAvailableVersions(
    appNameOrSlug: string,
    config?: FullConfig
  ): Promise<AvailableVersionInfo[]> {
    const target = appNameOrSlug.trim();
    const app = config
      ? Object.values(config.apps).find((a) => {
          const lower = target.toLowerCase();
          return (
            a.slug.toLowerCase() === lower ||
            a.name.toLowerCase() === lower ||
            inferPackageName(a).toLowerCase() === lower
          );
        })
      : undefined;

    const syntheticApp: AppConfig = {
      name: target,
      slug: target.toLowerCase(),
      enabled: true,
      rvBrand: 'Morphe',
      buildMode: 'both',
      patchMethod: 'revanced',
      version: 'latest',
      arch: 'arm64-v8a',
      patchesSource: '',
      patchesVersion: 'latest',
      cliSource: '',
      cliVersion: 'latest',
      exclusivePatches: false,
      includeStock: 'merged',
      enableUpdateChecks: true
    };

    const pkgName = target.includes('.')
      ? target
      : app
        ? inferPackageName(app)
        : inferPackageName(syntheticApp);

    const versionMap = new Map<string, Set<string>>();

    const addVersion = (ver: string, source: string) => {
      const clean = ver.trim().replace(/^v/, '');
      if (!clean || clean.length < 2) return;
      if (!versionMap.has(clean)) {
        versionMap.set(clean, new Set());
      }
      versionMap.get(clean)!.add(source);
    };

    const tasks: Promise<void>[] = [];

    // Source 1: Archive.org
    const archiveBaseUrl = app?.archiveDlurl || `https://archive.org/download/jhc-apks/apks/${pkgName}`;
    tasks.push(
      (async () => {
        try {
          const cleanUrl = archiveBaseUrl.replace(/\/+$/, '');
          const html = await this.http.fetchText(`${cleanUrl}/`);
          const regex = new RegExp(`[0-9a-zA-Z._-]+-([0-9a-zA-Z._-]+)-(all|arm64-v8a|arm-v7a|universal)`, 'gi');
          for (const m of html.matchAll(regex)) {
            if (m[1]) addVersion(m[1], 'Archive.org');
          }
        } catch {
          // ignore
        }
      })()
    );

    // Source 2: Aptoide REST API
    tasks.push(
      (async () => {
        try {
          const res = await this.http.fetchJson<any>(
            `https://ws75.aptoide.com/api/7/app/getVersions?package_name=${encodeURIComponent(pkgName)}`
          );
          if (Array.isArray(res?.list)) {
            for (const item of res.list) {
              if (item.file?.vername) {
                addVersion(item.file.vername, 'Aptoide');
              }
            }
          }
        } catch {
          // ignore
        }
      })()
    );

    // Source 3: APKCombo old-versions
    tasks.push(
      (async () => {
        try {
          const html = await this.http.fetchText(
            `https://apkcombo.com/app/${encodeURIComponent(pkgName)}/old-versions`,
            {
              headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0' }
            }
          );
          const regex = /<span class="vername">[^0-9]*([0-9]+(?:\.[0-9a-zA-Z]+)+)/g;
          for (const m of html.matchAll(regex)) {
            if (m[1]) addVersion(m[1], 'APKCombo');
          }
        } catch {
          // ignore
        }
      })()
    );

    await Promise.allSettled(tasks);

    // Check patch compatibility if app is configured
    const compatibleVersions: string[] = [];
    if (app && app.patchMethod !== 'lspatch' && app.patchesSource) {
      try {
        const { PatchInspector } = await import('../patches/inspector.js');
        const { ReleaseFetcher } = await import('../patches/fetcher.js');
        const { ToolManager } = await import('../tools/tool-manager.js');
        const toolManager = new ToolManager(this.ctx);
        await toolManager.ensureCmprBinaries();
        const fetcher = new ReleaseFetcher(this.ctx);
        const cliRelease = await fetcher.getCliJar(app.cliSource, app.cliVersion);
        const patchRelease = await fetcher.getPatchesBundle(app.patchesSource, app.patchesVersion);
        const inspector = new PatchInspector(this.ctx);
        const comp = await inspector.getCompatibleVersions(
          cliRelease.filePath,
          patchRelease.filePath,
          pkgName
        );
        for (const cv of comp) {
          compatibleVersions.push(cv);
          addVersion(cv, 'Patches');
        }
      } catch {
        // ignore
      }
    }

    const sorted = sortVersionsDescending([...versionMap.keys()]);
    return sorted.map((v) => ({
      version: v,
      sources: [...(versionMap.get(v) || [])],
      isPatchesCompatible: compatibleVersions.includes(v)
    }));
  }
}
