import path from 'node:path';
import { z } from 'zod';

export const AiReviewConfigSchema = z.object({
  version: z.literal(1),
  language: z.enum(['typescript']).default('typescript'),
  // HIGH-2/MED-4: Reject absolute paths and parent-directory traversals so
  // that tsconfigPath cannot escape the workspace when passed to ts-morph.
  tsconfig: z.string()
    .refine(
      (val) => !path.isAbsolute(val) && !path.normalize(val).startsWith('..'),
      { message: 'tsconfig must be a relative path within the workspace' },
    )
    .default('tsconfig.json'),
  layers: z.record(z.string(), z.array(z.string())).default({}),
  rules: z
    .object({
      'layer-dependency': z
        .object({
          allow: z.record(z.string(), z.array(z.string())),
          severity: z.enum(['high', 'medium', 'low']).default('high'),
        })
        .optional(),
      'no-cycles': z
        .object({
          scope: z.enum(['file', 'module']).default('module'),
          severity: z.enum(['high', 'medium', 'low']).default('high'),
        })
        .optional(),
      'public-api-only': z
        .object({
          modules: z.array(z.string()),
          severity: z.enum(['high', 'medium', 'low']).default('medium'),
        })
        .optional(),
      'forbidden-import': z
        .array(
          z.object({
            from: z.string(),
            deny: z.array(z.string()),
            severity: z.enum(['high', 'medium', 'low']).default('high'),
          }),
        )
        .optional(),
    })
    .default({}),
  llm: z
    .object({
      enabled: z.boolean().default(true),
      context: z.string().optional(),
      focus: z.array(z.string()).default([]),
    })
    .default({}),
  review: z
    .object({
      min_severity_inline: z.enum(['high', 'medium', 'low']).default('high'),
      max_inline_comments: z.number().int().positive().default(10),
      ignore: z
        .array(z.string())
        .default(['**/*.spec.ts', '**/generated/**', 'migrations/**']),
    })
    .default({}),
});

export type AiReviewConfig = z.infer<typeof AiReviewConfigSchema>;
