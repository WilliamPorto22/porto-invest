import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Gera dist/stats.html com treemap do bundle. Só roda no build de produção.
    // Abrir arquivo localmente após `npm run build` para inspecionar tamanhos.
    visualizer({
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true,
      template: 'treemap',
    }),
  ],
  // Remove console.log/info/debug do bundle de produção (mantém error/warn).
  // Evita vazar dados em prod e reduz ~2-3KB gzipped.
  esbuild: {
    pure: ['console.log', 'console.info', 'console.debug'],
    drop: ['debugger'],
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    // Por padrão o Vite gera <link rel="modulepreload"> para TODOS os chunks
    // transitivamente referenciados pela entry — mesmo os lazy. Isso faz o browser
    // baixar pdfjs/recharts/gsap/etc. no cold-start, anulando o code splitting.
    // Filtramos preload apenas para bibliotecas realmente usadas na primeira rota.
    modulePreload: {
      resolveDependencies: (_filename, deps) => {
        return deps.filter((d) =>
          !/pdfjs/.test(d) &&
          !/tesseract/.test(d) &&
          !/gsap/.test(d) &&
          !/recharts/.test(d) &&
          !/firebase-functions/.test(d)
        );
      },
    },
    // Divide vendors pesados em chunks separados para cacheabilidade entre deploys.
    // Cada chunk só é re-baixado quando sua própria lib muda.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-router')) return 'react-vendor';
          if (id.match(/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/)) return 'react-vendor';
          if (id.includes('firebase/auth') || id.match(/[\\/]@firebase[\\/]auth[\\/]/)) return 'firebase-auth';
          if (id.includes('firebase/firestore') || id.match(/[\\/]@firebase[\\/]firestore[\\/]/)) return 'firebase-firestore';
          if (id.includes('firebase/functions') || id.match(/[\\/]@firebase[\\/]functions[\\/]/)) return 'firebase-functions';
          if (id.includes('firebase/app') || id.match(/[\\/]@firebase[\\/](app|component|util|logger)[\\/]/)) return 'firebase-app';
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) return 'recharts';
          if (id.includes('/gsap/')) return 'gsap';
          if (id.includes('pdfjs-dist')) return 'pdfjs';
          if (id.includes('tesseract.js')) return 'tesseract';
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
})
