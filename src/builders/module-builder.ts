import fs from 'node:fs';
import path from 'node:path';
import { ZipArchive, type EntryData } from 'archiver';
import type { AppConfig, ConcreteArch } from '../core/types.js';
import type { AppContext } from '../core/context.js';

export class ModuleBuilder {
  constructor(private ctx: AppContext) {}

  public async buildMagiskModule(
    app: AppConfig,
    arch: ConcreteArch,
    appVersion: string,
    patchVersion: string,
    pkgName: string,
    patchedApkPath: string,
    stockApkPath: string,
    compressionLevel: number = 9
  ): Promise<string> {
    const appSlug = app.slug.toLowerCase().replace(/\s+/g, '-');
    const brandSlug = app.rvBrand.toLowerCase().replace(/\s+/g, '-');
    const archClean = arch.replace(/\s+/g, '-');

    const cleanVer = appVersion
      .replace(/^v/, '')
      .replace(/\s+/g, '-')
      .replace(/-release.*$/i, '')
      .replace(new RegExp(`-${archClean}$`, 'i'), '');

    const patchTag = patchVersion.replace(/^v/, '').replace(/^p/, '').replace(/\s+/g, '-');
    const patchVerStr = patchVersion === 'lsp' || app.patchMethod === 'lspatch' ? 'lsp' : `p${patchTag}`;

    const outputZipName = `${appSlug}-${brandSlug}-module-v${cleanVer}-${patchVerStr}-${archClean}.zip`;
    const outputZipPath = path.join(this.ctx.buildDir, outputZipName);

    this.ctx.log(`Packaging Magisk module: ${outputZipName}`);

    // Determine module arch string
    let moduleArch = '';
    if (arch === 'arm64-v8a') moduleArch = 'arm64';
    else if (arch === 'arm-v7a') moduleArch = 'arm';

    const propId = app.modulePropName || `${app.slug}-jhc`;
    const updateJsonUrl = `https://raw.githubusercontent.com/${this.ctx.githubRepository}/update/${app.slug}-update.json`;
    const versionDisplay = `${cleanVer}-${patchVerStr}`;

    // Generate config file content
    const configContent = `PKG_NAME=${pkgName}\nPKG_VER=${versionDisplay}\nMODULE_ARCH=${moduleArch}\n`;

    // Generate module.prop content
    let modulePropContent = `id=${propId}\nname=${app.name} ${app.rvBrand}\nversion=v${versionDisplay}\nversionCode=${this.ctx.nextVerCode}\nauthor=j-hc\ndescription=${app.name} ${app.rvBrand} module\n`;
    if (this.ctx.githubRepository) {
      modulePropContent += `updateJson=${updateJsonUrl}\n`;
    }

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputZipPath);
      const archive = new ZipArchive({
        zlib: { level: compressionLevel }
      });

      output.on('close', () => {
        this.ctx.success(`Built Magisk module: ${outputZipPath} (${archive.pointer()} bytes)`);
        resolve(outputZipPath);
      });

      archive.on('error', (err: any) => reject(err));
      archive.pipe(output);

      // 1. Add template files from module/
      if (fs.existsSync(this.ctx.moduleTemplateDir)) {
        archive.directory(this.ctx.moduleTemplateDir, false, (entry: EntryData) => {
          // Exclude template tmp files or unnecessary files
          if (entry.name.includes('/tmp.') || entry.name.endsWith('.bak')) return false;
          return entry;
        });
      }

      // 2. Add config and module.prop
      archive.append(configContent, { name: 'config' });
      archive.append(modulePropContent, { name: 'module.prop' });

      // 3. Add base.apk (the patched APK)
      archive.file(patchedApkPath, { name: 'base.apk' });

      // 4. Add stock APK if requested
      if (app.includeStock === 'merged' && fs.existsSync(stockApkPath)) {
        archive.file(stockApkPath, { name: 'stock/base.apk' });
      }

      archive.finalize();
    });
  }
}
