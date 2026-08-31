#!/usr/bin/env node

import { Context } from '@phoenix-ai/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@phoenix-ai/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@phoenix-ai/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
