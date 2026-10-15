export default { server: { fs: { allow: ['..'] } }, build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200, rollupOptions: { input: { main: 'index.html' } } } };
