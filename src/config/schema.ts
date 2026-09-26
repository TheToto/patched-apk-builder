import { z } from 'zod';

export const patchListSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((val): string[] => {
    if (!val) return [];
    if (Array.isArray(val)) return val.map((s) => s.trim()).filter(Boolean);
    // Parse bash-style quotes: 'Patch A' 'Patch B' or "Patch A" "Patch B"
    const regex = /['"]([^'"]+)['"]/g;
    const matches: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(val)) !== null) {
      if (match[1]?.trim()) {
        matches.push(match[1].trim());
      }
    }
    if (matches.length > 0) return matches;
    return val
      .split(/\s*,\s*|\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  });

export const rawAppConfigSchema = z.object({
  enabled: z.union([z.boolean(), z.string().transform((v) => v.toLowerCase() === 'true')]).default(true),
  'app-name': z.string().optional(),
  'rv-brand': z.string().optional(),
  'patches-source': z.string().optional(),
  'patches-version': z.string().default('latest'),
  'cli-source': z.string().optional(),
  'cli-version': z.string().default('latest'),
  'patch-method': z.enum(['revanced', 'lspatch']).default('revanced'),
  'xposed-module-asset': z.string().optional(),
  'build-mode': z.enum(['both', 'apk', 'module']).default('apk'),
  arch: z.enum(['arm64-v8a', 'arm-v7a', 'both', 'all', 'x86_64', 'x86']).default('all'),
  version: z.string().default('auto'),
  'pkg-name': z.string().optional(),
  dpi: z.string().optional(),
  'included-patches': patchListSchema,
  'excluded-patches': patchListSchema,
  'exclusive-patches': z.union([z.boolean(), z.string().transform((v) => v.toLowerCase() === 'true')]).default(false),
  'patcher-args': z.string().optional(),
  'include-stock': z.enum(['merged', 'split', 'disable']).default('merged'),
  'enable-update-checks': z.union([z.boolean(), z.string().transform((v) => v.toLowerCase() === 'true')]).default(false),
  'module-prop-name': z.string().optional(),
  info: z.string().optional(),
  'apkmirror-dlurl': z.string().optional(),
  'archive-dlurl': z.string().optional(),
  'uptodown-dlurl': z.string().optional(),
  'apkpure-dlurl': z.string().optional(),
  'direct-dlurl': z.string().optional(),
  'discord-dlurl': z.string().optional()
});

export const rawGlobalConfigSchema = z.object({
  'enable-module-update': z.union([z.boolean(), z.string().transform((v) => v.toLowerCase() === 'true')]).default(true),
  'parallel-jobs': z.coerce.number().default(1),
  'compression-level': z.coerce.number().min(0).max(9).default(9),
  'patches-source': z.string().default('ReVanced/revanced-patches'),
  'patches-version': z.string().default('latest'),
  'cli-source': z.string().default('ReVanced/revanced-cli'),
  'cli-version': z.string().default('latest'),
  'rv-brand': z.string().default('')
});

export type RawAppConfig = z.infer<typeof rawAppConfigSchema>;
export type RawGlobalConfig = z.infer<typeof rawGlobalConfigSchema>;
