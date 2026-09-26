#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { AppContext } from './core/context.js';
import { loadConfig } from './config/loader.js';
import { ChangeDetector } from './ci/change-detector.js';
import { BuildOrchestrator } from './orchestrator.js';
import { WebGenerator } from './web/generator.js';
import { CiNotifier } from './ci/notifier.js';
import { AaptTool } from './tools/aapt.js';
import { ApkSigner } from './tools/apk-signer.js';
import type { ConcreteArch } from './core/types.js';

const program = new Command();
const ctx = new AppContext();

program
  .name('revanced-builder')
  .description('Next-generation ReVanced, Morphe & LSPatch automated build pipeline in TypeScript')
  .version('2.0.0');

// Command: check
program
  .command('check')
  .description('Check for updates in patches and app versions')
  .option('-c, --config <path>', 'Path to configuration file', 'config.toml')
  .option('-f, --force', 'Force check to report all apps as needing build')
  .action(async (options) => {
    try {
      const config = loadConfig(options.config);
      const detector = new ChangeDetector(ctx);
      const result = await detector.detectChanges(config, { force: options.force });

      ctx.log(`Check complete. Should build: ${result.shouldBuild}`);
      if (result.shouldBuild) {
        ctx.success(`Apps needing update (${result.changedTargets.length}):`);
        for (const target of result.changedTargets) {
          console.log(`  - ${target.name} [${target.arch}] -> v${target.version} (${target.patchesTag})`);
        }
      } else {
        ctx.success('All applications are already up to date!');
      }

      // Export to GitHub Actions output if running in CI
      const ghOutput = process.env.GITHUB_OUTPUT;
      if (ghOutput && fs.existsSync(ghOutput)) {
        fs.appendFileSync(ghOutput, `SHOULD_BUILD=${result.shouldBuild ? '1' : '0'}\n`);
        fs.appendFileSync(ghOutput, `MATRIX_JSON=${result.matrixJson}\n`);
      }
    } catch (err: any) {
      ctx.error(`Check failed: ${err.message}`);
      process.exit(1);
    }
  });

// Command: build
program
  .command('build')
  .description('Build patched APKs and Magisk modules')
  .option('-c, --config <path>', 'Path to configuration file', 'config.toml')
  .option('-a, --app <slug>', 'Build only a specific application')
  .option('--arch <arch>', 'Target architecture (arm64-v8a, arm-v7a, etc.)')
  .option('--app-version <ver>', 'Override application version')
  .action(async (options) => {
    try {
      const config = loadConfig(options.config);
      const orchestrator = new BuildOrchestrator(ctx);

      if (options.app) {
        await orchestrator.buildSingle(
          config,
          options.app,
          options.arch as ConcreteArch,
          options.appVersion
        );
      } else {
        const activeApps = Object.values(config.apps).filter((a) => a.enabled);
        ctx.log(`Building all enabled applications (${activeApps.length})...`);
        for (const app of activeApps) {
          await orchestrator.buildSingle(config, app.slug);
        }
      }
      ctx.success('All requested builds finished successfully!');
    } catch (err: any) {
      ctx.error(`Build failed: ${err.message}`);
      process.exit(1);
    }
  });

// Command: web
program
  .command('web')
  .description('Generate web pages and Obtainium links')
  .option('-c, --config <path>', 'Path to configuration file', 'config.toml')
  .option('-u, --url <url>', 'Base website URL', 'https://apk.thetoto.fr')
  .option('-o, --out <dir>', 'Output directory for web pages')
  .action(async (options) => {
    try {
      const config = loadConfig(options.config);
      const generator = new WebGenerator(ctx);
      const outDir = options.out || ctx.pagesDir;
      await generator.generatePages(config, options.url, outDir);
    } catch (err: any) {
      ctx.error(`Web generation failed: ${err.message}`);
      process.exit(1);
    }
  });

// Command: notify
program
  .command('notify')
  .description('Send Telegram release notification')
  .option('--token <token>', 'Telegram bot token')
  .option('--chat <chat>', 'Telegram chat ID', '@rvc_magisk')
  .action(async (options) => {
    const token = options.token || process.env.TG_TOKEN || '';
    const notifier = new CiNotifier(ctx);
    await notifier.notifyTelegram(token, options.chat);
  });

// Command: sig
program
  .command('sig <apk>')
  .description('Extract SHA-256 signing certificate from an APK')
  .option('-a, --add', 'Append signature to sig.txt')
  .action(async (apkPath, options) => {
    try {
      const aapt = new AaptTool(ctx);
      const signer = new ApkSigner(ctx);
      const pkg = await aapt.getPackageId(apkPath);
      const cert = await signer.getCertSha256(apkPath);

      if (!cert) {
        ctx.error(`Could not read certificate from ${apkPath}`);
        process.exit(1);
      }

      ctx.success(`Package: ${pkg}`);
      ctx.success(`SHA-256: ${cert}`);
      console.log(`\nEntry format: ${cert} ${pkg}`);

      if (options.add) {
        const sigTxtPath = path.join(ctx.rootDir, 'sig.txt');
        const line = `${cert} ${pkg}\n`;
        const current = fs.existsSync(sigTxtPath) ? fs.readFileSync(sigTxtPath, 'utf-8') : '';
        if (current.includes(cert)) {
          ctx.warn(`Signature already present in sig.txt`);
        } else {
          fs.appendFileSync(sigTxtPath, line, 'utf-8');
          ctx.success(`Appended to sig.txt!`);
        }
      }
    } catch (err: any) {
      ctx.error(`Failed to extract signature: ${err.message}`);
      process.exit(1);
    }
  });

// Command: clean
program
  .command('clean')
  .description('Clean temporary directories and build artifacts')
  .action(() => {
    ctx.clean();
    ctx.success('Cleaned temp and build directories.');
  });

program.parse(process.argv);
