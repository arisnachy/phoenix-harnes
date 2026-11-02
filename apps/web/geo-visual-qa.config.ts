import { createRequire } from 'node:module'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const require = createRequire(import.meta.url)
// Isolated QA fixture: it mounts the ACTUAL production GeoMap component.
// Never served as the public Phoenix app. No fake app-level map markup.
export default defineConfig({
 root: new URL('.', import.meta.url).pathname,
 plugins: [react()],
 resolve: {
   dedupe: ['react','react-dom'],
   alias: [
     {find:/^react$/,replacement:require.resolve('react')},
     {find:/^react\/jsx-runtime$/,replacement:require.resolve('react/jsx-runtime')},
     {find:/^react\/jsx-dev-runtime$/,replacement:require.resolve('react/jsx-dev-runtime')},
   ],
 },
 base: './',
 build: { outDir: 'dist-geo-visual', emptyOutDir: true,
   rollupOptions: { input: new URL('./geo-visual-qa.html', import.meta.url).pathname } },
 preview: { host: '127.0.0.1', port: 5187, strictPort: true },
 server: { host: '127.0.0.1', port: 5187, strictPort: true },
})
