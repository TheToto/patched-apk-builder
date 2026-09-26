import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../core/context.js';
import { HttpClient } from '../core/http.js';

export class CiNotifier {
  private http = new HttpClient();

  constructor(private ctx: AppContext) {}

  public async notifyTelegram(tgToken: string, chatId: string = '@rvc_magisk'): Promise<void> {
    if (!tgToken) return;

    const buildDir = this.ctx.buildDir;
    if (!fs.existsSync(buildDir)) return;

    const files = fs.readdirSync(buildDir);
    const apks: string[] = [];
    const modules: string[] = [];

    const baseReleaseUrl = `https://github.com/${this.ctx.githubRepository}/releases/download/${this.ctx.nextVerCode}`;

    for (const file of files) {
      if (file.endsWith('.apk')) {
        apks.push(`📦 [${file}](${baseReleaseUrl}/${file})`);
      } else if (file.endsWith('.zip')) {
        modules.push(`📦 [${file}](${baseReleaseUrl}/${file})`);
      }
    }

    if (apks.length === 0 && modules.length === 0) return;

    let body = '*New build!*\n\n';
    const buildMdPath = path.join(this.ctx.rootDir, 'build.md');
    if (fs.existsSync(buildMdPath)) {
      body += fs.readFileSync(buildMdPath, 'utf-8') + '\n\n';
    }

    body += '*▼ Download Links:*\n';
    if (modules.length > 0) {
      body += 'Modules:\n' + modules.join('\n') + '\n\n';
    }
    if (apks.length > 0) {
      body += 'APKs:\n' + apks.join('\n') + '\n';
    }

    const payload = new URLSearchParams({
      chat_id: chatId,
      text: body.substring(0, 4000),
      parse_mode: 'Markdown',
      disable_web_page_preview: 'true'
    });

    try {
      await this.http.fetchWithRetry(`https://api.telegram.org/bot${tgToken}/sendMessage?${payload.toString()}`);
      this.ctx.success('Telegram notification sent successfully.');
    } catch (err: any) {
      this.ctx.warn(`Failed to send Telegram notification: ${err.message}`);
    }
  }
}
