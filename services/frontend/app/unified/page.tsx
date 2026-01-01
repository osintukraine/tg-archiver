import { Suspense } from 'react';
import UnifiedPageContent from './UnifiedPageContent';

// Force dynamic rendering for this page
export const dynamic = 'force-dynamic';

export default function UnifiedPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-400">Loading News Timeline...</p>
          </div>
        </div>
      }
    >
      <UnifiedPageContent />
    </Suspense>
  );
}
