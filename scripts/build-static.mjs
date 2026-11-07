/**
 * 静态导出构建（跨平台）
 *
 * 作用：以 STATIC_EXPORT=1 跑 next build，产物在 out/。
 * 由于 output: 'export' 不支持 API 路由，构建期间会把 app/api 临时移到
 * .static-stash/ 下，构建结束后无论成功失败都还原。
 *
 * 用法：npm run build:static
 */

import { spawn } from 'node:child_process';
import { existsSync, renameSync, mkdirSync, rmdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const apiDir = join(root, 'app', 'api');
const stashRoot = join(root, '.static-stash');
const stashDir = join(stashRoot, 'api');
/** dev 模式生成的类型校验文件会引用 app/api，留着会让静态构建的类型检查失败 */
const devTypes = join(root, '.next', 'dev');

function stash() {
  if (!existsSync(apiDir)) return false;
  if (!existsSync(stashRoot)) mkdirSync(stashRoot, { recursive: true });
  try {
    renameSync(apiDir, stashDir);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EBUSY') {
      console.error(
        '\n无法移开 app/api：目录正被占用。\n'
        + '静态导出不支持 API 路由，构建时需要临时把它移走。\n'
        + '请先关闭正在运行的 npm run dev / npm start，再重试。\n',
      );
      process.exit(1);
    }
    throw error;
  }
}

function restore(stashed) {
  if (!stashed) return;
  if (existsSync(stashDir)) renameSync(stashDir, apiDir);
  if (existsSync(stashRoot)) {
    try {
      rmdirSync(stashRoot);
    } catch {
      /* 非空就不删，无妨 */
    }
  }
}

// 清缓存属于尽力而为：删不掉也不该让构建失败
try {
  if (existsSync(devTypes)) rmSync(devTypes, { recursive: true, force: true });
} catch {
  console.warn('提示：未能清理 .next/dev 缓存，若类型检查报 app/api 相关错误，手动删除 .next 后重试。');
}

const stashed = stash();

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['next', 'build'],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, STATIC_EXPORT: '1' } },
);

child.on('exit', code => {
  restore(stashed);
  process.exit(code ?? 0);
});

child.on('error', error => {
  restore(stashed);
  console.error('静态构建启动失败：', error.message);
  process.exit(1);
});
