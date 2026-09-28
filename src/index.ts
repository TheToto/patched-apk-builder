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
import { ApkResolver } from './apk/resolver.js';
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

// Command: download
program
  .command('download [packageOrSlug]')
  .alias('dl')
  .description('Download an authentic APK by package name (e.g. com.reddit.frontpage) or app slug')
  .option('-a, --app <packageOrSlug>', 'Application package name or slug (e.g. com.reddit.frontpage, reddit)')
  .option('--pkg <package>', 'Application package name (e.g. com.reddit.frontpage)')
  .option('-c, --config <path>', 'Path to configuration file', 'config.toml')
  .option('-v, --app-version <ver>', 'Application version (e.g. 2026.14.0 or latest)')
  .option('-p, --provider <name>', 'Specific provider (archive, apkmirror, aptoide, apkpure, apkcombo, uptodown, github, direct)')
  .option('--arch <arch>', 'Target architecture (arm64-v8a, arm-v7a, all)', 'arm64-v8a')
  .option('-o, --out <dir>', 'Output directory for downloaded files', 'temp/downloads')
  .option('--all', 'Attempt download across all compatible providers and report results')
  .option('--no-verify', 'Skip signature verification against sig.txt')
  .action(async (packageOrSlug, options) => {
    try {
      const targetApp = packageOrSlug || options.pkg || options.app;
      if (!targetApp) {
        ctx.error('Please specify a package name or app slug (e.g. com.reddit.frontpage or reddit)');
        console.log('\nUsage:');
        console.log('  revanced-builder download com.reddit.frontpage');
        console.log('  revanced-builder download reddit -p aptoide');
        console.log('  revanced-builder download com.reddit.frontpage --all\n');
        process.exit(1);
      }

      let config;
      const configPath = path.resolve(options.config);
      if (fs.existsSync(configPath)) {
        config = loadConfig(configPath);
      }
      const resolver = new ApkResolver(ctx);
      ctx.log(`Starting APK download for: ${targetApp}...`);
      const results = await resolver.downloadStandaloneApk({
        appNameOrSlug: targetApp,
        config,
        version: options.appVersion,
        arch: options.arch as ConcreteArch,
        providerName: options.provider,
        outDir: options.out,
        tryAll: !!options.all,
        verifySignature: options.verify
      });

      console.log('\n--- Download Results ---');
      for (const res of results) {
        if (res.success) {
          const sizeMb = ((res.fileSize || 0) / (1024 * 1024)).toFixed(2);
          const sig = res.signatureValid === undefined ? 'SKIPPED' : res.signatureValid ? 'VALID' : 'INVALID';
          console.log(`\nProvider:   ${res.provider}`);
          console.log(`Status:     SUCCESS`);
          console.log(`File:       ${res.filePath}`);
          console.log(`Size:       ${sizeMb} MB ${res.isBundle ? '(bundle/split)' : ''}`);
          console.log(`Version:    ${res.versionFound || 'N/A'}`);
          console.log(`Signature:  ${sig} (SHA-256: ${res.certSha256 || 'N/A'})`);
        } else {
          console.log(`\nProvider:   ${res.provider}`);
          console.log(`Status:     FAILED`);
          console.log(`Error:      ${res.error}`);
        }
      }
      console.log('------------------------\n');

      const anySuccess = results.some((r) => r.success);
      if (!anySuccess) {
        ctx.error('All download attempts failed.');
        process.exit(1);
      } else {
        ctx.success('Download operation completed!');
      }
    } catch (err: any) {
      ctx.error(`Download failed: ${err.message}`);
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
