import { createRequire } from 'node:module'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
const require = createRequire(import.meta.url)
export default defineConfig({
 root: new URL('.',import.meta.url).pathname,
 base:'./',
 plugins:[react()],
 resolve:{
   dedupe:['react','react-dom'],
   alias:[
     {find:/^react$/,replacement:require.resolve('react')},
     {find:/^react\/jsx-runtime$/,replacement:require.resolve('react/jsx-runtime')},
     {find:/^react\/jsx-dev-runtime$/,replacement:require.resolve('react/jsx-dev-runtime')},
   ],
 },
 build:{outDir:'dist-scene-map-qa',emptyOutDir:true,
   rollupOptions:{input:new URL('./scene-map-qa.html',import.meta.url).pathname}},
 preview:{host:'127.0.0.1',port:5198,strictPort:true},
})
