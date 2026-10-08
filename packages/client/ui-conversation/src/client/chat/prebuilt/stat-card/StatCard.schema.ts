// Vendored unchanged from https://github.com/hemasurya106/react-generative-ui (v0.4.6, MIT)
import { z } from 'zod';

export const StatCardSchema = z.object({
  title: z.string(),
  value: z.union([z.string(), z.number()]),
  change: z.union([z.string(), z.number()]).optional(),
  trend: z.enum(['up', 'down', 'neutral']).optional(),
  icon: z.string().optional(),
});
