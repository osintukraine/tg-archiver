'use client';

import { useState, useCallback } from 'react';

/**
 * DataTable Component
 *
 * Reusable table with sorting, pagination, selection, and bulk actions.
 * Follows platform theme conventions with glass styling.
 */

export interface Column<T> {
  key: keyof T | string;
  label: string;
  sortable?: boolean;
  render?: (value: any, row: T) => React.ReactNode;
  width?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  loading?: boolean;
  error?: string | null;

  // Pagination
  currentPage?: number;
  totalPages?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  totalItems?: number;

  // Sorting
  sortKey?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (key: string) => void;

  // Selection
  selectable?: boolean;
  selectedKeys?: Set<string | number>;
  onSelectionChange?: (keys: Set<string | number>) => void;

  // Row actions
  rowActions?: (row: T) => React.ReactNode;

  // Bulk actions (shown when items selected)
  bulkActions?: React.ReactNode;

  // Empty state
  emptyState?: React.ReactNode;
  emptyMessage?: string;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  loading,
  error,
  currentPage = 1,
  totalPages = 1,
  pageSize = 50,
  onPageChange,
  totalItems,
  sortKey,
  sortDirection = 'asc',
  onSort,
  selectable,
  selectedKeys = new Set(),
  onSelectionChange,
  rowActions,
  bulkActions,
  emptyState,
  emptyMessage = 'No data available',
}: DataTableProps<T>) {
  const allKeys = new Set(data.map(keyExtractor));
  const allSelected = data.length > 0 && Array.from(allKeys).every((k) => selectedKeys.has(k));
  const someSelected = selectedKeys.size > 0 && !allSelected;

  const toggleAll = useCallback(() => {
    if (allSelected) {
      onSelectionChange?.(new Set());
    } else {
      onSelectionChange?.(allKeys);
    }
  }, [allSelected, allKeys, onSelectionChange]);

  const toggleRow = useCallback(
    (key: string | number) => {
      const newSelection = new Set(selectedKeys);
      if (newSelection.has(key)) {
        newSelection.delete(key);
      } else {
        newSelection.add(key);
      }
      onSelectionChange?.(newSelection);
    },
    [selectedKeys, onSelectionChange]
  );

  const getValue = (row: T, key: string | keyof T): any => {
    if (typeof key === 'string' && key.includes('.')) {
      return key.split('.').reduce((obj: any, k) => obj?.[k], row);
    }
    return (row as any)[key];
  };

  if (error) {
    return (
      <div className="glass p-8 text-center">
        <div className="text-red-500 mb-2">
          <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <p className="text-text-tertiary">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bulk Actions Bar */}
      {selectedKeys.size > 0 && bulkActions && (
        <div className="glass p-4 flex items-center justify-between">
          <span className="text-text-secondary">
            <span className="font-medium text-text-primary">{selectedKeys.size}</span> selected
          </span>
          <div className="flex gap-2">{bulkActions}</div>
        </div>
      )}

      {/* Table */}
      <div className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-bg-secondary border-b border-border-subtle">
              <tr>
                {selectable && (
                  <th className="w-12 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={toggleAll}
                      className="rounded border-border-subtle"
                    />
                  </th>
                )}
                {columns.map((col) => (
                  <th
                    key={String(col.key)}
                    className="px-4 py-3 text-left text-sm font-medium text-text-secondary"
                    style={{ width: col.width }}
                  >
                    {col.sortable && onSort ? (
                      <button
                        onClick={() => onSort(String(col.key))}
                        className="flex items-center gap-2 hover:text-text-primary transition-colors"
                      >
                        {col.label}
                        {sortKey === col.key && (
                          <span className="text-blue-500">
                            {sortDirection === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                ))}
                {rowActions && <th className="w-24 px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {loading ? (
                // Loading skeleton
                Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    {selectable && (
                      <td className="px-4 py-4">
                        <div className="w-4 h-4 bg-bg-tertiary rounded" />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={String(col.key)} className="px-4 py-4">
                        <div className="h-4 bg-bg-tertiary rounded w-3/4" />
                      </td>
                    ))}
                    {rowActions && (
                      <td className="px-4 py-4">
                        <div className="h-4 bg-bg-tertiary rounded w-16" />
                      </td>
                    )}
                  </tr>
                ))
              ) : data.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)}
                    className="px-4 py-12"
                  >
                    {emptyState || (
                      <div className="text-center text-text-tertiary">
                        <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                        </svg>
                        <p>{emptyMessage}</p>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                data.map((row) => {
                  const key = keyExtractor(row);
                  const isSelected = selectedKeys.has(key);
                  return (
                    <tr
                      key={key}
                      className={`
                        hover:bg-bg-secondary/50 transition-colors
                        ${isSelected ? 'bg-blue-500/5' : ''}
                      `}
                    >
                      {selectable && (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(key)}
                            className="rounded border-border-subtle"
                          />
                        </td>
                      )}
                      {columns.map((col) => {
                        const value = getValue(row, col.key);
                        return (
                          <td
                            key={`${key}-${String(col.key)}`}
                            className="px-4 py-3 text-sm text-text-primary"
                          >
                            {col.render ? col.render(value, row) : String(value ?? '')}
                          </td>
                        );
                      })}
                      {rowActions && (
                        <td className="px-4 py-3 text-right">
                          {rowActions(row)}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-t border-border-subtle px-3 sm:px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs sm:text-sm text-text-secondary">
              {totalItems ? (
                <>
                  {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, totalItems)} of {totalItems}
                </>
              ) : (
                <>{currentPage} / {totalPages}</>
              )}
            </div>
            <div className="flex gap-1.5 sm:gap-2">
              <button
                onClick={() => onPageChange?.(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-3 py-2.5 sm:px-3 sm:py-1.5 rounded bg-bg-secondary hover:bg-bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed text-sm transition-colors"
              >
                Prev
              </button>

              {/* Page numbers */}
              <div className="hidden sm:flex gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => onPageChange?.(pageNum)}
                      className={`px-3 py-1.5 rounded text-sm transition-colors ${
                        pageNum === currentPage
                          ? 'bg-blue-600 text-white'
                          : 'bg-bg-secondary hover:bg-bg-tertiary'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              {/* Mobile page indicator */}
              <span className="sm:hidden px-2 py-2.5 text-sm text-text-secondary">
                {currentPage}/{totalPages}
              </span>

              <button
                onClick={() => onPageChange?.(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-3 py-2.5 sm:px-3 sm:py-1.5 rounded bg-bg-secondary hover:bg-bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed text-sm transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
