/**
 * Loading skeleton for the admin stats page.
 * Matches the layout of the full page to prevent layout shifts.
 */
export function StatsPageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex justify-between items-start">
        <div>
          <div className="h-8 bg-gray-300 dark:bg-gray-700 rounded w-32 mb-2" />
          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-64" />
        </div>
        <div className="flex items-center gap-4">
          <div className="h-10 bg-gray-200 dark:bg-gray-800 rounded w-32" />
          <div className="h-10 bg-gray-200 dark:bg-gray-800 rounded w-20" />
        </div>
      </div>

      {/* Pipeline status banner skeleton */}
      <div className="glass p-4 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-gray-300 dark:bg-gray-700 rounded-full" />
            <div className="h-5 bg-gray-300 dark:bg-gray-700 rounded w-24" />
          </div>
          <div className="flex gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-20" />
            ))}
          </div>
        </div>
      </div>

      {/* Stats grid skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="h-8 bg-gray-300 dark:bg-gray-700 rounded w-16 mb-2" />
                <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-20" />
              </div>
              <div className="w-8 h-8 bg-gray-200 dark:bg-gray-800 rounded" />
            </div>
          </div>
        ))}
      </div>

      {/* Charts skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2].map((i) => (
          <div key={i} className="glass p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="h-5 bg-gray-300 dark:bg-gray-700 rounded w-24" />
              <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-16" />
            </div>
            <div className="h-24 bg-gray-200 dark:bg-gray-800 rounded" />
            <div className="flex justify-between mt-2">
              <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-16" />
              <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-16" />
            </div>
          </div>
        ))}
      </div>

      {/* Quality panel skeleton */}
      <div className="glass p-6">
        <div className="h-6 bg-gray-300 dark:bg-gray-700 rounded w-40 mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="flex justify-between">
                <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-20" />
                <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-10" />
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Two column panels skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <div key={i} className="glass p-6">
            <div className="h-6 bg-gray-300 dark:bg-gray-700 rounded w-32 mb-4" />
            <div className="grid grid-cols-2 gap-4 mb-4">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="bg-bg-secondary p-3 rounded">
                  <div className="h-8 bg-gray-300 dark:bg-gray-700 rounded w-12 mb-1" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-16" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
