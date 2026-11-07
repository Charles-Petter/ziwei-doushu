/**
 * /library/search?q=xxx — 搜索结果页（静态导出兼容：查询参数在客户端读取）
 */

import { Suspense } from 'react';
import SearchClient from './SearchClient';

export const dynamic = 'force-static';

export const metadata = {
  title: '搜索 · 古籍原典库',
};

export default function SearchPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg-page)' }} />}>
      <SearchClient />
    </Suspense>
  );
}
