// Vendored unchanged from https://github.com/hemasurya106/react-generative-ui (v0.4.6, MIT)
import { z } from 'zod';

export const DataTableSchema = z.object({
  title: z.string().optional(),
  headers: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.any())),
});
