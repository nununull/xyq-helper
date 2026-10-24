/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { create175dtProxy } from './server/175dt-proxy.mjs'

export default defineConfig({
  // 使用相对资源路径，确保 dist 部署在任意子目录时都能正确加载静态文件
  base: './',
  publicDir: false,
  plugins: [vue(), {
    name: '175dt-screenshot-proxy',
    /** 在开发服务器中挂载同源截图转发。 */
    configureServer(server) {
      server.middlewares.use(create175dtProxy())
    },
    /** 在构建预览中复用相同的175dt转发入口。 */
    configurePreviewServer(server) {
      server.middlewares.use(create175dtProxy())
    },
  }],
  test: {
    environment: 'node',
    clearMocks: true,
  },
})
