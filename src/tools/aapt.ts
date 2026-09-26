import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { AppContext } from '../core/context.js';

export class AaptTool {
  constructor(private ctx: AppContext) {}

  private getAaptCmd(): string {
    const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (androidHome) {
      const btDir = path.join(androidHome, 'build-tools');
      if (fs.existsSync(btDir)) {
        try {
          const versions = fs.readdirSync(btDir).sort().reverse();
          for (const v of versions) {
            const aaptPath = path.join(btDir, v, 'aapt');
            if (fs.existsSync(aaptPath)) return aaptPath;
          }
        } catch {
          // ignore
        }
      }
    }
    return 'aapt';
  }

  public async getPackageId(apkPath: string): Promise<string> {
    const cmd = this.getAaptCmd();
    try {
      const { stdout } = await this.ctx.exec(cmd, ['dump', 'badging', apkPath], { silent: true });
      for (const line of stdout.split('\n')) {
        if (line.startsWith('package:')) {
          const match = line.match(/name='([^']+)'/);
          if (match && match[1]) {
            return match[1];
          }
        }
      }
    } catch {
      // Fallback: search string inside AndroidManifest.xml
    }

    throw new Error(`Could not extract package name from ${apkPath}`);
  }

  public async extractIcon(apkPath: string, outPngPath: string, fallbackSlug?: string): Promise<boolean> {
    // 1. Check if a static icon exists in icons/ folder
    if (fallbackSlug) {
      const staticIcon = path.join(this.ctx.iconsDir, `${fallbackSlug}.png`);
      if (fs.existsSync(staticIcon)) {
        fs.copyFileSync(staticIcon, outPngPath);
        return true;
      }
    }

    try {
      // 2. Query icon path with aapt dump badging
      const cmd = this.getAaptCmd();
      const { stdout } = await this.ctx.exec(cmd, ['dump', 'badging', apkPath], { silent: true });
      let iconPath: string | null = null;
      for (const line of stdout.split('\n')) {
        if (line.startsWith('application:')) {
          const match = line.match(/icon='([^']+)'/);
          if (match && match[1]) {
            iconPath = match[1];
            break;
          }
        }
      }

      if (!iconPath) {
        return false;
      }

      const zip = new AdmZip(apkPath);

      // If direct PNG or WEBP
      if (iconPath.endsWith('.png') || iconPath.endsWith('.webp')) {
        const entry = zip.getEntry(iconPath);
        if (entry) {
          fs.writeFileSync(outPngPath, entry.getData());
          return true;
        }
      }

      // If adaptive icon, find best resolution raster in res/mipmap or res/drawable
      const entries = zip.getEntries();
      const densityPriorities = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi'];
      let bestEntry = null;

      for (const density of densityPriorities) {
        const candidate = entries.find(
          (e) =>
            e.entryName.includes(density) &&
            (e.entryName.includes('ic_launcher') || e.entryName.includes('icon')) &&
            (e.entryName.endsWith('.png') || e.entryName.endsWith('.webp'))
        );
        if (candidate) {
          bestEntry = candidate;
          break;
        }
      }

      if (bestEntry) {
        fs.writeFileSync(outPngPath, bestEntry.getData());
        return true;
      }

      return false;
    } catch (err: any) {
      this.ctx.warn(`Could not extract icon for ${apkPath}: ${err.message}`);
      return false;
    }
  }
}
