'use client';

interface MediaDotsProps {
  total: number;
  current: number;
  onSelect?: (index: number) => void;
}

export function MediaDots({ total, current, onSelect }: MediaDotsProps) {
  if (total <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2 py-2">
      {Array.from({ length: total }, (_, i) => (
        <button
          key={i}
          onClick={() => onSelect?.(i)}
          className={`w-2 h-2 rounded-full transition-all ${
            i === current
              ? 'bg-white w-4'
              : 'bg-white/40 hover:bg-white/60'
          }`}
          aria-label={`Go to media ${i + 1}`}
        />
      ))}
    </div>
  );
}
