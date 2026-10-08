// Vendored unchanged from https://github.com/hemasurya106/react-generative-ui (v0.4.6, MIT)
import { z } from 'zod';

export const TimelineSchema = z.object({
  title: z.string().optional(),
  items: z.array(z.object({
    date: z.string(),
    title: z.string(),
    description: z.string().optional(),
  })),
});
