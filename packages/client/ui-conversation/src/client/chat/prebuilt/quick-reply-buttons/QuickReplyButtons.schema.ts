// Vendored unchanged from https://github.com/hemasurya106/react-generative-ui (v0.4.6, MIT)
import { z } from 'zod';

export const QuickReplyButtonsSchema = z.object({
  buttons: z.array(z.object({
    label: z.string(),
    id: z.string(),
  })),
});
