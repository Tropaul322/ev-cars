"use client";

import { Button } from "@/components/ui/button";

type AdminVehiclesPaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
};

export function AdminVehiclesPagination({
  page,
  pageSize,
  total,
  totalPages,
  loading = false,
  onPageChange
}: AdminVehiclesPaginationProps) {
  if (total === 0) {
    return <p className="text-sm text-muted-foreground">No vehicles match the current filters.</p>;
  }

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        Showing {start}–{end} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <span className="px-2 text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
