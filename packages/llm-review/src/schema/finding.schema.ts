import { z } from 'zod';

export const FindingSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  severity: z.enum(['low', 'medium', 'high']),
  category: z.enum(['layering', 'responsibility', 'abstraction-leak', 'coupling', 'pattern']),
  title: z.string().max(200),
  rationale: z.string().max(1000),
  suggestion: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1),
});

export type Finding = z.infer<typeof FindingSchema>;

export const FindingsOutputSchema = z.object({
  findings: z.array(FindingSchema),
});
