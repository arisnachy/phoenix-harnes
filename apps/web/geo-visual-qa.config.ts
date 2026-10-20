import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Isolated QA fixture: it mounts the ACTUAL production GeoMap component.
// Never served as the public Phoenix app. No fake app-level map markup.
export default defineConfig({
 root: 'apps/web',
 plugins: [react()],
 resolve: { dedupe: ['react','react-dom'] },
 server: { host: '127.0.0.1', port: 5187, strictPort: true },
})
