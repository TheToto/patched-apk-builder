import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../core/context.js';
import { ToolManager } from './tool-manager.js';

export class ApkSigner {
  private toolManager: ToolManager;

  constructor(private ctx: AppContext) {
    this.toolManager = new ToolManager(this.ctx);
  }

  public async signApk(
    inputApk: string,
    outputApk: string,
    keystorePath: string = path.join(this.ctx.rootDir, 'ks-p12.keystore'),
    alias: string = 'jhc',
    pass: string = '123456789'
  ): Promise<void> {
    const signerJar = this.toolManager.getApkSignerPath();

    const args: string[] = [];
    if (signerJar.endsWith('.jar')) {
      args.push('-jar', signerJar);
    }
    args.push(
      'sign',
      '--ks',
      keystorePath,
      '--ks-pass',
      `pass:${pass}`,
      '--key-pass',
      `pass:${pass}`,
      '--ks-key-alias',
      alias,
      '--out',
      outputApk,
      inputApk
    );

    const cmd = signerJar.endsWith('.jar') ? 'java' : signerJar;
    await this.ctx.exec(cmd, args, { silent: true });

    // Remove any .idsig created by apksigner
    const idsig = `${outputApk}.idsig`;
    if (fs.existsSync(idsig)) {
      try {
        fs.unlinkSync(idsig);
      } catch {
        // ignore
      }
    }
  }

  public async getCertSha256List(apkPath: string): Promise<string[]> {
    const signerJar = this.toolManager.getApkSignerPath();
    const args: string[] = [];
    if (signerJar.endsWith('.jar')) {
      args.push('-jar', signerJar);
    }
    args.push('verify', '--print-certs', apkPath);

    const cmd = signerJar.endsWith('.jar') ? 'java' : signerJar;
    try {
      const { stdout } = await this.ctx.exec(cmd, args, { silent: true });
      // Primary match: Signer #<n> certificate SHA-256 digest: <hex>
      const signerMatches = [...stdout.matchAll(/Signer\s+#\d+\s+certificate\s+SHA-256\s+digest:\s*([0-9a-fA-F]{64})/gi)];
      if (signerMatches.length > 0) {
        return signerMatches.map(m => m[1].toLowerCase());
      }
      // Fallback match: any SHA-256 digest line
      const fallbackMatches = [...stdout.matchAll(/SHA-256 digest:\s*([0-9a-fA-F]{64})/gi)];
      return fallbackMatches.map(m => m[1].toLowerCase());
    } catch (err: any) {
      this.ctx.warn(`Failed to verify certificate for ${apkPath}: ${err.message}`);
      return [];
    }
  }

  public async getCertSha256(apkPath: string): Promise<string | null> {
    const list = await this.getCertSha256List(apkPath);
    return list.length > 0 ? list[0] : null;
  }

  public async verifySignatureAgainstSigTxt(apkPath: string, pkgName: string): Promise<boolean> {
    const sigTxtPath = path.join(this.ctx.rootDir, 'sig.txt');
    if (!fs.existsSync(sigTxtPath)) {
      return true; // No sig.txt, skip verification
    }

    const content = fs.readFileSync(sigTxtPath, 'utf-8');
    const knownSignatures: Record<string, Set<string>> = {};

    for (const line of content.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const hash = parts[0].toLowerCase();
        const pkg = parts[1];
        if (!knownSignatures[pkg]) {
          knownSignatures[pkg] = new Set();
        }
        knownSignatures[pkg].add(hash);
      }
    }

    const expectedSigs = knownSignatures[pkgName];
    if (!expectedSigs || expectedSigs.size === 0) {
      // Package not in sig.txt, nothing to enforce
      return true;
    }

    const actualSigs = await this.getCertSha256List(apkPath);
    if (actualSigs.length === 0) {
      this.ctx.error(`Could not read certificate from ${apkPath}`);
      return false;
    }

    const matchFound = actualSigs.some(sig => expectedSigs.has(sig));
    if (!matchFound) {
      this.ctx.error(
        `Signature mismatch for ${pkgName}!\nExpected: ${[...expectedSigs].join(', ')}\nActual:   ${actualSigs.join(', ')}`
      );
      return false;
    }

    this.ctx.log(`Verified official signature for ${pkgName}`);
    return true;
  }
}
