/**
 * 两种构建模式：
 *   1) npm run build        → 常规服务端构建，/api/* 可用（AI 解读需要这种）
 *   2) npm run build:static → 纯静态导出到 out/，可托管在 GitHub Pages 等静态空间
 *
 * 静态导出模式不支持 API 路由，由 scripts/build-static.mjs 在构建期间临时移开 app/api。
 */

const isStatic = process.env.STATIC_EXPORT === '1';

/**
 * 部署到子路径时才需要（如 GitHub Pages 项目页 /ziwei-doushu）。
 * 走根域名时留空即可。
 */
const basePath = (process.env.STATIC_BASE_PATH || '').replace(/\/+$/, '') || undefined;

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['lunar-javascript'],
  ...(basePath ? { basePath } : {}),
  ...(isStatic
    ? {
        output: 'export',
        images: { unoptimized: true },
      }
    : {}),
};

module.exports = nextConfig;
