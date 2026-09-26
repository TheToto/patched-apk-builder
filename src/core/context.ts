import path from 'node:path';
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import pc from 'picocolors';

export class AppContext {
  public readonly rootDir: string;
  public readonly tempDir: string;
  public readonly buildDir: string;
  public readonly toolsDir: string;
  public readonly iconsDir: string;
  public readonly moduleTemplateDir: string;
  public readonly pagesDir: string;

  public readonly githubToken: string;
  public readonly githubRepository: string;
  public readonly nextVerCode: string;

  constructor(rootDir: string = process.cwd()) {
    this.rootDir = path.resolve(rootDir);
    this.tempDir = path.join(this.rootDir, 'temp');
    this.buildDir = path.join(this.rootDir, 'build');
    this.toolsDir = path.join(this.tempDir, 'tools');
    this.iconsDir = path.join(this.rootDir, 'icons');
    this.moduleTemplateDir = path.join(this.rootDir, 'module');
    this.pagesDir = process.env.PAGES_DIR || '/tmp/pages';

    this.githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || this.getGhAuthToken();
    this.githubRepository = process.env.GITHUB_REPOSITORY || 'TheToto/revanced-magisk-module';
    this.nextVerCode = process.env.NEXT_VER_CODE || '1';

    this.ensureDirs();
  }

  private getGhAuthToken(): string {
    try {
      return execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' }).trim();
    } catch {
      return '';
    }
  }

  public ensureDirs(): void {
    fs.mkdirSync(this.tempDir, { recursive: true });
    fs.mkdirSync(this.buildDir, { recursive: true });
    fs.mkdirSync(this.toolsDir, { recursive: true });
  }

  public clean(): void {
    if (fs.existsSync(this.tempDir)) {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    }
    if (fs.existsSync(this.buildDir)) {
      fs.rmSync(this.buildDir, { recursive: true, force: true });
    }
    const buildMd = path.join(this.rootDir, 'build.md');
    if (fs.existsSync(buildMd)) {
      fs.rmSync(buildMd, { force: true });
    }
  }

  public log(msg: string): void {
    console.log(pc.cyan('ℹ ') + msg);
  }

  public success(msg: string): void {
    console.log(pc.green('✔ ') + pc.bold(msg));
  }

  public warn(msg: string): void {
    console.warn(pc.yellow('⚠ ') + msg);
  }

  public error(msg: string): void {
    console.error(pc.red('✖ ') + pc.bold(msg));
  }

  public async exec(
    cmd: string,
    args: string[] = [],
    options: { cwd?: string; env?: Record<string, string>; silent?: boolean } = {}
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: options.cwd || this.rootDir,
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (d) => {
        stdout += d.toString();
        if (!options.silent && process.env.VERBOSE) {
          process.stdout.write(d);
        }
      });

      child.stderr?.on('data', (d) => {
        stderr += d.toString();
        if (!options.silent && process.env.VERBOSE) {
          process.stderr.write(d);
        }
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr, code: code || 0 });
        } else {
          const err = new Error(`Command failed with code ${code}: ${cmd} ${args.join(' ')}\n${stderr}`);
          (err as any).stdout = stdout;
          (err as any).stderr = stderr;
          (err as any).code = code;
          reject(err);
        }
      });

      child.on('error', (err) => reject(err));
    });
  }
}
