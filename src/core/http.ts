import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export interface HttpOptions {
  headers?: Record<string, string>;
  token?: string;
  timeoutMs?: number;
  retries?: number;
}

export const USER_AGENT_BROWSER =
  'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';

export class HttpClient {
  constructor(private defaultToken?: string) {}

  public getHeaders(options?: HttpOptions): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT_BROWSER,
      ...options?.headers
    };

    const token = options?.token || this.defaultToken;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  public async fetchWithRetry(url: string, options?: HttpOptions): Promise<Response> {
    const retries = options?.retries ?? 3;
    const timeout = options?.timeoutMs ?? 30000;
    let lastError: any;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const res = await fetch(url, {
          headers: this.getHeaders(options),
          signal: controller.signal
        });
        clearTimeout(timer);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText} for URL: ${url}`);
        }
        return res;
      } catch (err: any) {
        lastError = err;
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError;
  }

  public async fetchJson<T>(url: string, options?: HttpOptions): Promise<T> {
    const res = await this.fetchWithRetry(url, options);
    return (await res.json()) as T;
  }

  public async fetchText(url: string, options?: HttpOptions): Promise<string> {
    const res = await this.fetchWithRetry(url, options);
    return await res.text();
  }

  public async downloadFile(url: string, destPath: string, options?: HttpOptions): Promise<string> {
    const tempDest = `${destPath}.tmp.${Date.now()}`;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const res = await this.fetchWithRetry(url, options);
    if (!res.body) {
      throw new Error(`Empty body when downloading from: ${url}`);
    }

    const fileStream = fs.createWriteStream(tempDest);
    // Node.js web-stream to readable stream
    const readable = Readable.fromWeb(res.body as any);
    await pipeline(readable, fileStream);

    fs.renameSync(tempDest, destPath);
    return destPath;
  }
}
