import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { AppConfig, ConcreteArch, BuildMode } from '../core/types.js';
import type { AppContext } from '../core/context.js';
import { ApkSigner } from '../tools/apk-signer.js';

export class ApkBuilder {
  private signer: ApkSigner;

  constructor(private ctx: AppContext) {
    this.signer = new ApkSigner(this.ctx);
  }

  public stripUnwantedLibs(inputApk: string, outputApk: string, targetArch: ConcreteArch, isModule: boolean): void {
    fs.copyFileSync(inputApk, outputApk);
    const zip = new AdmZip(outputApk);

    const entries = zip.getEntries();
    let modified = false;

    for (const entry of entries) {
      if (!entry.entryName.startsWith('lib/')) continue;

      if (isModule) {
        // Magisk modules do not need bundled libs in base.apk
        zip.deleteFile(entry.entryName);
        modified = true;
      } else {
        const name = entry.entryName;
        if (targetArch === 'arm64-v8a') {
          if (name.includes('armeabi-v7a/') || name.includes('x86/') || name.includes('x86_64/')) {
            zip.deleteFile(name);
            modified = true;
          }
        } else if (targetArch === 'arm-v7a') {
          if (name.includes('arm64-v8a/') || name.includes('x86/') || name.includes('x86_64/')) {
            zip.deleteFile(name);
            modified = true;
          }
        } else if (targetArch === 'x86') {
          if (name.includes('arm64-v8a/') || name.includes('armeabi-v7a/') || name.includes('x86_64/')) {
            zip.deleteFile(name);
            modified = true;
          }
        } else if (targetArch === 'x86_64') {
          if (name.includes('arm64-v8a/') || name.includes('armeabi-v7a/') || name.includes('x86/')) {
            zip.deleteFile(name);
            modified = true;
          }
        }
      }
    }

    if (modified) {
      zip.writeZip(outputApk);
    }
  }

  public async patchWithLsPatch(
    stockApk: string,
    lspatchJar: string,
    xposedModuleApk: string,
    outputApk: string
  ): Promise<string> {
    this.ctx.log(`Patching with LSPatch: ${path.basename(stockApk)} + ${path.basename(xposedModuleApk)}`);
    const tempDir = path.join(this.ctx.tempDir, `lspatch-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const keystore = path.join(this.ctx.rootDir, 'ks-p12.keystore');
    const args = [
      '-jar',
      lspatchJar,
      stockApk,
      '-k',
      keystore,
      '123456789',
      'jhc',
      '123456789',
      '-m',
      xposedModuleApk,
      '-o',
      tempDir
    ];

    try {
      await this.ctx.exec('java', args, { silent: false });
      const files = fs.readdirSync(tempDir);
      const lspatched = files.find((f) => f.includes('lspatched') && f.endsWith('.apk'));
      if (!lspatched) {
        throw new Error(`LSPatch failed: no output apk found in ${tempDir}`);
      }
      fs.copyFileSync(path.join(tempDir, lspatched), outputApk);
      return outputApk;
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  public async patchWithReVanced(
    stockApk: string,
    cliJar: string,
    patchesJar: string,
    app: AppConfig,
    mode: BuildMode,
    allPatchesListRaw: string,
    outputApk: string
  ): Promise<string> {
    this.ctx.log(`Patching with ReVanced/Morphe: ${path.basename(stockApk)} (mode: ${mode})`);
    const tempWorkDir = path.join(this.ctx.tempDir, `patch-work-${Date.now()}`);
    fs.mkdirSync(tempWorkDir, { recursive: true });

    const keystore = path.join(this.ctx.rootDir, 'ks.keystore');
    const isMorphe = path.basename(cliJar).toLowerCase().includes('morphe');

    const args = [
      '-jar',
      cliJar,
      'patch',
      stockApk,
      '-o',
      outputApk,
      '-p',
      patchesJar,
      '--keystore',
      keystore,
      '--keystore-entry-password',
      '123456789',
      '--keystore-password',
      '123456789',
      '--signer',
      'jhc',
      '--keystore-entry-alias',
      'jhc',
      '-t',
      tempWorkDir
    ];

    if (!isMorphe) {
      args.push('-b');
    }

    // Detect microg patch
    const microgMatch = allPatchesListRaw.match(/Name:\s*([^\n]*(?:gmscore|microg)[^\n]*)/i);
    const microgPatchName = microgMatch && microgMatch[1] ? microgMatch[1].trim() : null;

    // Detect branding patch
    const brandingMatch = allPatchesListRaw.match(/Name:\s*([^\n]*custom branding[^\n]*)/i);
    const brandingPatchName = brandingMatch && brandingMatch[1] ? brandingMatch[1].trim() : null;

    // Build-mode specific microg & branding rules
    if (mode === 'apk') {
      if (microgPatchName) {
        args.push('-e', microgPatchName);
      }
    } else if (mode === 'module') {
      if (microgPatchName) {
        args.push('-d', microgPatchName);
      }
      if (brandingPatchName) {
        args.push('-d', brandingPatchName);
      }
    }

    // User-configured inclusions & exclusions
    if (app.includedPatches && app.includedPatches.length > 0) {
      for (const p of app.includedPatches) {
        if (microgPatchName && p.toLowerCase() === microgPatchName.toLowerCase()) continue;
        args.push('-e', p);
      }
    }

    if (app.excludedPatches && app.excludedPatches.length > 0) {
      for (const p of app.excludedPatches) {
        if (microgPatchName && p.toLowerCase() === microgPatchName.toLowerCase()) continue;
        args.push('-d', p);
      }
    }

    if (app.exclusivePatches) {
      args.push('--exclusive');
    }

    if (app.version === 'latest') {
      args.push('-f');
    }

    if (app.patcherArgs) {
      const extra = app.patcherArgs.split(/\s+/).filter(Boolean);
      args.push(...extra);
    }

    try {
      await this.ctx.exec('java', args, { silent: false });
      if (!fs.existsSync(outputApk)) {
        throw new Error(`ReVanced CLI failed to produce output APK: ${outputApk}`);
      }
      return outputApk;
    } finally {
      try {
        fs.rmSync(tempWorkDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}
