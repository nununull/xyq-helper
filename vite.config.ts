/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 使用相对资源路径，确保 dist 部署在任意子目录时都能正确加载静态文件
  base: './',
  plugins: [vue()],
  test: {
    environment: 'node',
    clearMocks: true,
  },
})
