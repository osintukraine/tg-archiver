export default function Loading() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="glass p-8 rounded-xl animate-pulse">
        <div className="h-6 bg-border-subtle rounded-sm w-1/4 mb-4"></div>
        <div className="h-4 bg-border-subtle rounded-sm w-3/4 mb-2"></div>
        <div className="h-4 bg-border-subtle rounded-sm w-2/3 mb-2"></div>
        <div className="h-4 bg-border-subtle rounded-sm w-1/2 mb-4"></div>
        <div className="h-64 bg-border-subtle rounded-sm mb-4"></div>
      </div>
    </div>
  );
}
