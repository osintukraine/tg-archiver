'use client';

import dynamic from 'next/dynamic';

// Dynamically import NewsTimeline to avoid SSR issues with ReactFlow
const NewsTimeline = dynamic(
  () => import('@/components/timeline/NewsTimeline').then((mod) => mod.NewsTimeline),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">Loading timeline...</p>
        </div>
      </div>
    ),
  }
);

export default function UnifiedPageContent() {
  return (
    <div className="h-screen">
      <NewsTimeline className="h-full" />
    </div>
  );
}
