import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../core/context.js';
import type { FullConfig, AppConfig, PatchesSummaryJson } from '../core/types.js';
import { buildObtainiumDeepLink } from './obtainium.js';
import { AaptTool } from '../tools/aapt.js';

export class WebGenerator {
  private aapt: AaptTool;

  constructor(private ctx: AppContext) {
    this.aapt = new AaptTool(this.ctx);
  }

  private loadQrSvg(): string {
    const p = path.join(this.ctx.rootDir, 'scripts', 'qr.svg');
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8').trim();
    }
    return '<span>QR</span>';
  }

  public async generatePages(
    config: FullConfig,
    baseUrl: string = 'https://apk.thetoto.fr',
    outDir: string = this.ctx.pagesDir
  ): Promise<void> {
    fs.mkdirSync(outDir, { recursive: true });

    // Copy style.css
    const cssSource = path.join(this.ctx.rootDir, 'scripts', 'style.css');
    if (fs.existsSync(cssSource)) {
      fs.copyFileSync(cssSource, path.join(outDir, 'style.css'));
    }

    // Write CNAME for custom domain
    try {
      const parsedDomain = new URL(baseUrl).hostname;
      if (parsedDomain && !parsedDomain.includes('localhost') && !parsedDomain.endsWith('.github.io')) {
        fs.writeFileSync(path.join(outDir, 'CNAME'), parsedDomain, 'utf-8');
      }
    } catch {
      // ignore
    }

    const qrSvg = this.loadQrSvg();
    const [owner, repoName] = this.ctx.githubRepository.split('/');

    // MicroG RE Obtainium payload
    const microgPayload = JSON.stringify({
      id: 'app.revanced.android.gms',
      url: 'https://github.com/MorpheApp/MicroG-RE',
      author: 'MorpheApp',
      name: 'MicroG RE'
    });
    const microgObtainiumLink = `obtainium://app/${encodeURIComponent(microgPayload)}`;

    const activeApps = Object.values(config.apps).filter((a) => a.enabled);

    // 1. Generate index.html (exact layout from Python scripts/gen_index.py)
    let appCardsHtml = '';
    for (const app of activeApps) {
      const iconUrl = `./${app.slug}.png`;
      appCardsHtml += `            <a href="${app.slug}.html" class="card">
                <div class="card-icon-wrap">
                    <img src="${iconUrl}" alt="${app.name} icon" class="card-icon" onerror="this.parentElement.style.display='none'">
                </div>
                <h2>${app.name}</h2>
                <span class="card-brand">${app.rvBrand}</span>
            </a>\n`;
    }

    const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${owner} Modded APKs Repository</title>
    <link rel="stylesheet" href="./style.css">
</head>
<body>
    <div class="container">
        <h1>${owner} Modded APKs Repository</h1>

        <div class="tools-grid">
            <div class="obtainium-section">
                <h2>📥 Obtainium</h2>
                <p>Install <strong>Obtainium</strong> to easily add applications and get <strong>automatic updates</strong>.</p>
                <div class="obtainium-actions">
                    <a href="https://obtainium.imranr.dev/" class="btn-manual" target="_blank" rel="noopener">Install Obtainium</a>
                    <button class="btn-qr" onclick="document.getElementById('qr-modal-obtainium').classList.add('active')" title="Scan QR Code">
                        ${qrSvg}
                    </button>
                </div>
            </div>

            <div class="microg-section">
                <h2>⚙️ MicroG RE</h2>
                <p>Certain apps (such as <strong>YouTube</strong> and <strong>YouTube Music</strong>) require <strong>MicroG RE</strong> for non-root standalone APKs to work without official Google Play Services.</p>
                <div class="microg-actions">
                    <a href="https://github.com/MorpheApp/MicroG-RE/releases" class="btn-manual" target="_blank" rel="noopener">Manual Download</a>
                    <button class="btn-qr" onclick="document.getElementById('qr-modal-apk-microg').classList.add('active')" title="Show APK QR Code">
                        ${qrSvg}
                    </button>

                    <a href="${microgObtainiumLink}" class="badge-obtainium">
                        <img src="https://raw.githubusercontent.com/ImranR98/Obtainium/main/assets/graphics/badge_obtainium.png" alt="Get it on Obtainium">
                    </a>
                    <button class="btn-qr" onclick="document.getElementById('qr-modal-obt-microg').classList.add('active')" title="Show Obtainium QR Code">
                        ${qrSvg}
                    </button>
                </div>
            </div>
        </div>

        <div class="grid">
${appCardsHtml}        </div>
        
        <footer>
            <p>Source code and CI on GitHub: <a href="https://github.com/${owner}/${repoName}" target="_blank" rel="noopener">${owner}/${repoName}</a></p>
        </footer>
    </div>
    
    <div class="modal-overlay" id="qr-modal-apk-microg" onclick="if(event.target === this) this.classList.remove('active')">
        <div class="modal-content">
            <button class="modal-close" onclick="document.getElementById('qr-modal-apk-microg').classList.remove('active')">&times;</button>
            <p style="margin: 0 0 1.5rem 0; font-weight: 600; font-size: 1.1rem; color: var(--text-primary);">Scan to Download MicroG</p>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=1&data=${encodeURIComponent('https://github.com/MorpheApp/MicroG-RE/releases')}" alt="APK QR Code" style="background: white; padding: 0.5rem; border-radius: 12px; width: 280px; height: 280px;">
        </div>
    </div>

    <div class="modal-overlay" id="qr-modal-obt-microg" onclick="if(event.target === this) this.classList.remove('active')">
        <div class="modal-content">
            <button class="modal-close" onclick="document.getElementById('qr-modal-obt-microg').classList.remove('active')">&times;</button>
            <p style="margin: 0 0 1.5rem 0; font-weight: 600; font-size: 1.1rem; color: var(--text-primary);">Scan to add in Obtainium</p>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=1&data=${encodeURIComponent(microgObtainiumLink)}" alt="Obtainium QR Code" style="background: white; padding: 0.5rem; border-radius: 12px; width: 280px; height: 280px;">
        </div>
    </div>

    <div class="modal-overlay" id="qr-modal-obtainium" onclick="if(event.target === this) this.classList.remove('active')">
        <div class="modal-content">
            <button class="modal-close" onclick="document.getElementById('qr-modal-obtainium').classList.remove('active')">&times;</button>
            <p style="margin: 0 0 1.5rem 0; font-weight: 600; font-size: 1.1rem; color: var(--text-primary);">Scan to install Obtainium</p>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=1&data=${encodeURIComponent('https://obtainium.imranr.dev/')}" alt="Obtainium Releases QR Code" style="background: white; padding: 0.5rem; border-radius: 12px; width: 280px; height: 280px;">
        </div>
    </div>
</body>
</html>`;

    fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml, 'utf-8');

    // 2. Generate per-app detail pages (exact layout from Python scripts/gen_app_pages.py)
    for (const app of activeApps) {
      await this.generateAppPage(app, baseUrl, outDir, qrSvg, owner, repoName, activeApps);
    }

    this.ctx.success(`Generated website successfully in ${outDir}`);
  }

  private async generateAppPage(
    app: AppConfig,
    baseUrl: string,
    outDir: string,
    qrSvg: string,
    owner: string,
    repoName: string,
    allApps: AppConfig[] = []
  ): Promise<void> {
    const htmlFilename = `${app.slug}.html`;
    const pageUrl = `${baseUrl}/${htmlFilename}`;
    const iconFilename = `${app.slug}.png`;
    const iconOutPath = path.join(outDir, iconFilename);

    const appSlug = app.slug.toLowerCase().replace(/\s+/g, '-');
    const brandSlug = app.rvBrand.toLowerCase().replace(/\s+/g, '-');
    const nameSlug = app.name.toLowerCase().replace(/\s+/g, '-');
    const appDisplayName = app.name;

    const buildFiles = fs.existsSync(this.ctx.buildDir) ? fs.readdirSync(this.ctx.buildDir) : [];

    const isFileForApp = (filename: string, isModule: boolean): boolean => {
      const lower = filename.toLowerCase();

      // Ensure it does not belong to a more specific application slug (e.g. youtube-experimental vs youtube)
      const hasBetterMatch = allApps.some((other) => {
        if (other.slug === app.slug) return false;
        const otherSlug = other.slug.toLowerCase().replace(/\s+/g, '-');
        return otherSlug.length > appSlug.length && lower.startsWith(`${otherSlug}-`);
      });
      if (hasBetterMatch) return false;

      if (isModule) {
        if (!lower.endsWith('.zip') || !lower.includes('module')) return false;
        return (
          lower.startsWith(`${appSlug}-${brandSlug}-module-`) ||
          lower.startsWith(`${nameSlug}-${brandSlug}-module-`) ||
          (lower.startsWith(`${appSlug}-`) && lower.includes('-module-'))
        );
      } else {
        if (!lower.endsWith('.apk') || lower.includes('-module-')) return false;
        return (
          lower.startsWith(`${appSlug}-${brandSlug}-`) ||
          lower.startsWith(`${nameSlug}-${brandSlug}-`) ||
          lower.startsWith(`${appSlug}-`)
        );
      }
    };

    // Find APKs
    const matchedApks = buildFiles.filter((f) => isFileForApp(f, false));

    // Find Module ZIPs
    const matchedModules = buildFiles.filter((f) => isFileForApp(f, true));

    // Sort descending by version
    matchedApks.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    matchedModules.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

    // Keep only the latest APK and Module per arch
    const apksByArch = new Map<string, string>();
    for (const apk of matchedApks) {
      const archMatch = apk.match(/-(arm64-v8a|arm-v7a|x86_64|x86|all)\.apk$/i);
      const arch = archMatch ? archMatch[1] : 'all';
      if (!apksByArch.has(arch)) {
        apksByArch.set(arch, apk);
      }
    }
    const latestApks = Array.from(apksByArch.values());

    const modulesByArch = new Map<string, string>();
    for (const mod of matchedModules) {
      const archMatch = mod.match(/-(arm64-v8a|arm-v7a|x86_64|x86|all)\.zip$/i);
      const arch = archMatch ? archMatch[1] : 'all';
      if (!modulesByArch.has(arch)) {
        modulesByArch.set(arch, mod);
      }
    }
    const latestModules = Array.from(modulesByArch.values());

    // If no new builds were produced for this app in this run, but an existing page already exists,
    // preserve the existing page so we don't break existing download links or Obtainium!
    const targetHtmlPath = path.join(outDir, htmlFilename);
    if (latestApks.length === 0 && latestModules.length === 0 && fs.existsSync(targetHtmlPath)) {
      this.ctx.log(`Preserving existing ${htmlFilename} (no new build in this run)`);
      return;
    }

    // Copy or extract icon
    const staticIcon = path.join(this.ctx.iconsDir, iconFilename);
    const buildIcon = path.join(this.ctx.buildDir, iconFilename);
    if (fs.existsSync(staticIcon)) {
      fs.copyFileSync(staticIcon, iconOutPath);
    } else if (fs.existsSync(buildIcon)) {
      fs.copyFileSync(buildIcon, iconOutPath);
    } else if (latestApks.length > 0) {
      const firstApk = path.join(this.ctx.buildDir, latestApks[0]);
      await this.aapt.extractIcon(firstApk, iconOutPath, app.slug);
    }

    // Extract package ID and versions
    let appId = app.pkgName || 'com.unknown';
    let version = 'Latest';
    let archDisplay: string = app.arch || 'all';

    if (latestApks.length > 0) {
      const firstApk = path.join(this.ctx.buildDir, latestApks[0]);
      try {
        appId = await this.aapt.getPackageId(firstApk);
      } catch {
        // ignore
      }

      // Parse standardized or legacy format: appslug-patchname-v<version>-<patchversion>-<arch>.apk
      const stdMatch = latestApks[0].match(
        /^([a-z0-9-]+)-([a-z0-9-]+)-v?([0-9a-zA-Z._-]+)-(p[0-9a-zA-Z._-]+|lsp)-(arm64-v8a|arm-v7a|x86_64|x86|all)\.apk$/i
      );
      if (stdMatch) {
        version = `${stdMatch[3]} (${stdMatch[4]})`;
        archDisplay = stdMatch[5];
      } else {
        const legMatch = latestApks[0].match(
          /^(?:.*)-v([0-9a-zA-Z._-]+?)(?:-(p[0-9a-zA-Z._-]+))?-(arm64-v8a|arm-v7a|x86_64|x86|all)\.apk$/i
        );
        if (legMatch) {
          version = legMatch[2] ? `${legMatch[1]} (${legMatch[2]})` : legMatch[1];
          archDisplay = legMatch[3] || 'all';
        }
      }
    } else if (latestModules.length > 0) {
      const stdMatch = latestModules[0].match(
        /^([a-z0-9-]+)-([a-z0-9-]+)-module-v?([0-9a-zA-Z._-]+)-(p[0-9a-zA-Z._-]+|lsp)-(arm64-v8a|arm-v7a|x86_64|x86|all)\.zip$/i
      );
      if (stdMatch) {
        version = `${stdMatch[3]} (${stdMatch[4]})`;
        archDisplay = stdMatch[5];
      } else {
        const legMatch = latestModules[0].match(
          /^(?:.*)-module-v([0-9a-zA-Z._-]+?)(?:-(p[0-9a-zA-Z._-]+))?-(arm64-v8a|arm-v7a|x86_64|x86|all)\.zip$/i
        );
        if (legMatch) {
          version = legMatch[2] ? `${legMatch[1]} (${legMatch[2]})` : legMatch[1];
          archDisplay = legMatch[3] || 'all';
        }
      }
    }

    // Patch source link
    let brandLink = `https://github.com/${app.patchesSource}`;
    if (app.patchesSource.startsWith('http://') || app.patchesSource.startsWith('https://')) {
      brandLink = app.patchesSource;
    } else if (app.patchesSource.startsWith('codeberg.org/')) {
      brandLink = `https://${app.patchesSource}`;
    }

    const brandHtml = `<a href="${brandLink}" class="brand-link" target="_blank" rel="noopener">${app.rvBrand}</a>`;
    const patchSourceDisplay = app.patchMethod === 'lspatch' ? `LSPatch: ${brandHtml}` : brandHtml;

    // Info warning card
    let infoCardHtml = '';
    const infoText = app.info ? app.info.trim() : '';
    if (infoText) {
      const infoHtml = infoText
        .replace(/(https?:\/\/[^\s<]+[^.\s<])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
        .replace(/\n/g, '<br>');
      infoCardHtml = `
        <div class="info-card">
            <div class="info-card-header">
                <span class="info-card-icon">⚠️</span>
                <span class="info-card-title">Warning</span>
            </div>
            <div class="info-card-content">${infoHtml}</div>
        </div>
`;
    }

    // Generate Standalone APK download cards and modals
    let apkCardsHtml = '';
    let apkModalsHtml = '';

    if (latestApks.length === 0) {
      apkCardsHtml = `
        <div class="download-card apk-card">
            <div class="download-card-header">
                <span class="card-badge apk-badge">📱 Standalone APK (Non-Root)</span>
            </div>
            <p style="color: var(--text-secondary); margin: 1.5rem 0;">No build available yet. It will appear here once compiled.</p>
        </div>`;
    } else {
      for (let i = 0; i < latestApks.length; i++) {
        const filename = latestApks[i];
        const downloadUrl = `${baseUrl}/releases/download/${this.ctx.nextVerCode}/${filename}`;
        const modalApkId = `qr-modal-apk${latestApks.length > 1 ? `-${i}` : ''}`;
        const modalObtId = `qr-modal-obt${latestApks.length > 1 ? `-${i}` : ''}`;

        const obtainium = buildObtainiumDeepLink({
          id: appId,
          name: appDisplayName,
          author: owner,
          pageUrl,
          brand: app.rvBrand,
          isMagiskModule: false
        });

        apkCardsHtml += `
        <div class="download-card apk-card">
            <div class="download-card-header">
                <span class="card-badge apk-badge">📱 Standalone APK (Non-Root)</span>
            </div>
            <div class="filename-raw">
                File: <code>${filename}</code>
            </div>
            <div class="actions-group">
                <div class="action-row">
                    <a href="${downloadUrl}" class="btn btn-download">Download APK</a>
                    <button class="btn-qr" onclick="document.getElementById('${modalApkId}').classList.add('active')" title="Show APK QR Code">
                        ${qrSvg}
                    </button>
                </div>
                <div class="action-row">
                    <a href="${obtainium.deepLink}" class="badge-obtainium">
                        <img src="https://raw.githubusercontent.com/ImranR98/Obtainium/main/assets/graphics/badge_obtainium.png" alt="Get it on Obtainium">
                    </a>
                    <button class="btn-qr" onclick="document.getElementById('${modalObtId}').classList.add('active')" title="Show Obtainium QR Code">
                        ${qrSvg}
                    </button>
                </div>
            </div>
        </div>\n`;

        apkModalsHtml += `
    <div class="modal-overlay" id="${modalApkId}" onclick="if(event.target === this) this.classList.remove('active')">
        <div class="modal-content">
            <button class="modal-close" onclick="document.getElementById('${modalApkId}').classList.remove('active')">&times;</button>
            <p style="margin: 0 0 1.5rem 0; font-weight: 600; font-size: 1.1rem; color: var(--text-primary);">Scan to Download APK</p>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=1&data=${encodeURIComponent(downloadUrl)}" alt="APK QR Code" style="background: white; padding: 0.5rem; border-radius: 12px; width: 280px; height: 280px;">
        </div>
    </div>

    <div class="modal-overlay" id="${modalObtId}" onclick="if(event.target === this) this.classList.remove('active')">
        <div class="modal-content">
            <button class="modal-close" onclick="document.getElementById('${modalObtId}').classList.remove('active')">&times;</button>
            <p style="margin: 0 0 1.5rem 0; font-weight: 600; font-size: 1.1rem; color: var(--text-primary);">Scan to add in Obtainium</p>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=1&data=${encodeURIComponent(obtainium.deepLink)}" alt="Obtainium QR Code" style="background: white; padding: 0.5rem; border-radius: 12px; width: 280px; height: 280px;">
        </div>
    </div>\n`;
      }
    }

    // Generate Magisk Module section and modals
    let moduleSectionHtml = '';
    let moduleModalsHtml = '';

    if (latestModules.length > 0) {
      for (let i = 0; i < latestModules.length; i++) {
        const moduleFilename = latestModules[i];
        const moduleDownloadUrl = `${baseUrl}/releases/download/${this.ctx.nextVerCode}/${moduleFilename}`;
        const modalModId = `qr-modal-module${latestModules.length > 1 ? `-${i}` : ''}`;

        moduleSectionHtml += `
        <div class="download-card module-card">
            <div class="download-card-header">
                <span class="card-badge module-badge">⚡ Magisk / KernelSU / APatch Module (Root)</span>
            </div>
            <div class="filename-raw">
                File: <code>${moduleFilename}</code>
            </div>
            <div class="actions-group">
                <div class="action-row">
                    <a href="${moduleDownloadUrl}" class="btn btn-download-module">Download Module (.zip)</a>
                    <button class="btn-qr" onclick="document.getElementById('${modalModId}').classList.add('active')" title="Show Module QR Code">
                        ${qrSvg}
                    </button>
                </div>
            </div>
            <div class="module-notice">
                <span class="notice-icon">💡</span>
                <span>Download the <code>.zip</code> file, then open <strong>KernelSU</strong> (or Magisk / APatch) &rarr; <strong>Modules</strong> tab &rarr; <strong>Install module</strong>. Subsequent updates will be managed <strong>automatically</strong> inside the app!</span>
            </div>
        </div>\n`;

        moduleModalsHtml += `
    <div class="modal-overlay" id="${modalModId}" onclick="if(event.target === this) this.classList.remove('active')">
        <div class="modal-content">
            <button class="modal-close" onclick="document.getElementById('${modalModId}').classList.remove('active')">&times;</button>
            <p style="margin: 0 0 1.5rem 0; font-weight: 600; font-size: 1.1rem; color: var(--text-primary);">Scan to Download Magisk/KernelSU Module (.zip)</p>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=1&data=${encodeURIComponent(moduleDownloadUrl)}" alt="Module QR Code" style="background: white; padding: 0.5rem; border-radius: 12px; width: 280px; height: 280px;">
        </div>
    </div>\n`;

        // Generate *-update.json for Magisk module
        const updateJsonPath = path.join(outDir, `${app.slug}-update.json`);
        const updateData = {
          version: `v${version}`,
          versionCode: parseInt(this.ctx.nextVerCode, 10) || 1,
          zipUrl: moduleDownloadUrl,
          changelog: `https://raw.githubusercontent.com/${this.ctx.githubRepository}/update/build.md`
        };
        fs.writeFileSync(updateJsonPath, JSON.stringify(updateData, null, 2), 'utf-8');

        // Also generate brand-specific alias if different (e.g. youtube-morphe-update.json) for older setups
        if (brandSlug && brandSlug !== appSlug) {
          const brandUpdateJsonPath = path.join(outDir, `${app.slug}-${brandSlug}-update.json`);
          fs.writeFileSync(brandUpdateJsonPath, JSON.stringify(updateData, null, 2), 'utf-8');
        }
      }
    }

    // Generate Patches details list
    let patchesListHtml = '';
    const patchesJsonFiles = buildFiles.filter((f) => {
      if (!f.endsWith('.patches.json')) return false;
      const lower = f.toLowerCase();
      const hasBetterMatch = allApps.some((other) => {
        if (other.slug === app.slug) return false;
        const otherSlug = other.slug.toLowerCase().replace(/\s+/g, '-');
        return otherSlug.length > appSlug.length && lower.startsWith(`${otherSlug}-`);
      });
      if (hasBetterMatch) return false;
      return (
        lower.startsWith(`${appSlug}-${brandSlug}-`) ||
        lower.startsWith(`${nameSlug}-${brandSlug}-`) ||
        lower.startsWith(`${appSlug}-`)
      );
    });

    patchesJsonFiles.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

    if (patchesJsonFiles.length > 0) {
      try {
        const rawJson = fs.readFileSync(path.join(this.ctx.buildDir, patchesJsonFiles[0]), 'utf-8');
        const patchesData: PatchesSummaryJson = JSON.parse(rawJson);
        const patches = patchesData.patches || [];
        let appliedCount = 0;

        const processedPatches = patches.map((p) => {
          let status = 'disabled';
          if (p.explicitly_disabled) status = 'explicitly_disabled';
          else if (p.explicitly_enabled) status = 'explicitly_enabled';
          else if (p.default_enabled) status = 'enabled';

          if (status === 'explicitly_enabled' || status === 'enabled') {
            appliedCount++;
          }

          return {
            name: p.name,
            description: p.description && p.description.toLowerCase() !== 'null' ? p.description : 'No description available.',
            status,
            default_enabled: p.default_enabled
          };
        });

        const statusOrder: Record<string, number> = {
          explicitly_disabled: 0,
          explicitly_enabled: 1,
          enabled: 2,
          disabled: 3
        };
        processedPatches.sort((a, b) => {
          const ordA = statusOrder[a.status] ?? 4;
          const ordB = statusOrder[b.status] ?? 4;
          if (ordA !== ordB) return ordA - ordB;
          return a.name.localeCompare(b.name);
        });

        let patchCardsHtml = '';
        for (const p of processedPatches) {
          const statusClass =
            p.status === 'explicitly_disabled'
              ? 'excluded'
              : p.status === 'explicitly_enabled' || p.status === 'enabled'
                ? 'applied'
                : 'disabled';

          let statusLabel = 'Disabled';
          if (p.status === 'explicitly_disabled') {
            statusLabel = 'Explicitly Disabled';
          } else if (p.status === 'explicitly_enabled') {
            statusLabel = p.default_enabled ? 'Explicitly Enabled (Default)' : 'Explicitly Enabled (Not Default)';
          } else if (p.status === 'enabled') {
            statusLabel = 'Enabled';
          }

          patchCardsHtml += `
                <div class="patch-card ${statusClass}">
                    <div class="patch-header">
                        <span class="patch-name">${p.name}</span>
                        <span class="patch-status status-${statusClass}">${statusLabel}</span>
                    </div>
                    <div class="patch-desc">${p.description}</div>
                </div>`;
        }

        patchesListHtml = `
        <div class="patches-section">
            <h3 class="patches-title">⚙️ Applied Patches (${appliedCount}/${processedPatches.length})</h3>
            <div class="patches-list">${patchCardsHtml}
            </div>
        </div>\n`;
      } catch (e: any) {
        this.ctx.warn(`Could not parse patches file ${patchesJsonFiles[0]}: ${e.message}`);
      }
    }

    const appHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Download ${appDisplayName}</title>
    <link rel="stylesheet" href="./style.css">
</head>
<body class="app-page">
    <div class="container app-container">
        <a href="index.html" class="back-link">← Back to Apps List</a>
        <div class="header-content">
            <div class="app-icon-wrap">
                <img src="./${iconFilename}" alt="${appDisplayName} icon" class="app-icon" onerror="this.parentElement.style.display='none'">
            </div>
            <h1>${appDisplayName}</h1>
        </div>
        
        <div class="info-grid">
            <div class="info-item">
                <span class="info-label">Version</span>
                <span class="info-value">v${version}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Patch Source</span>
                <span class="info-value">${patchSourceDisplay}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Architecture</span>
                <span class="info-value">${archDisplay}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Package ID</span>
                <span class="info-value" style="font-size: 0.9rem; word-break: break-all;">${appId}</span>
            </div>
        </div>
        
        ${infoCardHtml}
        ${apkCardsHtml}
        ${moduleSectionHtml}
        ${patchesListHtml}
        <footer>
            <p>Source code and CI on GitHub: <a href="https://github.com/${owner}/${repoName}" target="_blank" rel="noopener">${owner}/${repoName}</a></p>
        </footer>
    </div>

    ${apkModalsHtml}
    ${moduleModalsHtml}
</body>
</html>`;

    fs.writeFileSync(path.join(outDir, `${app.slug}.html`), appHtml, 'utf-8');
  }
}
