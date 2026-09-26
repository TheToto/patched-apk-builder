import fs from 'node:fs';
import type { AppContext } from '../core/context.js';
import { ToolManager } from './tool-manager.js';
import { ApkSigner } from './apk-signer.js';

export class ApkEditor {
  private toolManager: ToolManager;
  private signer: ApkSigner;

  constructor(private ctx: AppContext) {
    this.toolManager = new ToolManager(this.ctx);
    this.signer = new ApkSigner(this.ctx);
  }

  public async mergeBundle(bundlePath: string, outputApkPath: string): Promise<string> {
    const jarPath = await this.toolManager.getApkEditorJar();
    const unsignedTemp = `${outputApkPath}.unsigned.apk`;

    this.ctx.log(`Merging split APK bundle: ${bundlePath} -> ${outputApkPath}`);

    const args = [
      '-jar',
      jarPath,
      'merge',
      '-i',
      bundlePath,
      '-o',
      unsignedTemp,
      '-clean-meta',
      '-f'
    ];

    try {
      await this.ctx.exec('java', args, { silent: true });
      if (!fs.existsSync(unsignedTemp)) {
        throw new Error(`APKEditor merge failed to produce ${unsignedTemp}`);
      }

      // Sign the merged APK
      await this.signer.signApk(unsignedTemp, outputApkPath);
      return outputApkPath;
    } finally {
      if (fs.existsSync(unsignedTemp)) {
        try {
          fs.unlinkSync(unsignedTemp);
        } catch {
          // ignore
        }
      }
    }
  }
}
