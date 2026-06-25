import { cn } from "@/lib/utils";

type AdminTableSkeletonProps = {
  rows?: number;
  columns?: number;
  className?: string;
};

export function AdminTableSkeleton({
  rows = 6,
  columns = 5,
  className
}: AdminTableSkeletonProps) {
  return (
    <div className={cn("overflow-hidden rounded-3xl border border-border", className)}>
      <div className="flex flex-col gap-0 border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex gap-4">
          {Array.from({ length: columns }).map((_, index) => (
            <div
              key={`header-${index}`}
              className="h-4 flex-1 animate-pulse rounded-md bg-muted"
              style={{ maxWidth: index === 0 ? "8rem" : undefined }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div
            key={`row-${rowIndex}`}
            className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-b-0"
          >
            {Array.from({ length: columns }).map((_, columnIndex) => (
              <div
                key={`cell-${rowIndex}-${columnIndex}`}
                className={cn(
                  "h-4 animate-pulse rounded-md bg-muted/70",
                  columnIndex === 0 ? "w-32" : "flex-1"
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminPageHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-9 w-56 animate-pulse rounded-xl bg-muted" />
      <div className="h-5 w-96 max-w-full animate-pulse rounded-lg bg-muted/70" />
    </div>
  );
}
