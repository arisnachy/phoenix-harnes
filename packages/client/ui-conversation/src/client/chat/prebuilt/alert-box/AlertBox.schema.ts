// Vendored unchanged from https://github.com/hemasurya106/react-generative-ui (v0.4.6, MIT)
import { z } from 'zod';

export const AlertBoxSchema = z.object({
  type: z.enum(['info', 'success', 'warning', 'error']),
  title: z.string().optional(),
  message: z.string(),
});
