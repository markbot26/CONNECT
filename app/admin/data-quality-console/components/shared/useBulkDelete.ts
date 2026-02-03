'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/lib/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import React from 'react';

interface UseBulkDeleteOptions {
  tableName: string;
  onSuccess: () => void;
}

export function useBulkDelete({ tableName, onSuccess }: UseBulkDeleteOptions) {
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  const bulkDelete = useCallback(
    async (ids: string[]): Promise<boolean> => {
      setIsDeleting(true);
      try {
        const res = await fetch(
          `/api/admin/data-quality-console/${tableName}/bulk-delete`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
          }
        );

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast({
            title: '일괄 삭제 실패',
            description: body.error || '알 수 없는 오류가 발생했습니다.',
            variant: 'destructive',
          });
          return false;
        }

        const data = await res.json();
        const undoTokens: string[] = data.undoTokens || [];

        toast({
          title: '일괄 삭제 완료',
          description: data.message || `${ids.length}개 항목이 삭제되었습니다.`,
          action: undoTokens.length > 0
            ? (React.createElement(
                ToastAction,
                {
                  altText: '전체 실행 취소',
                  onClick: () => undoAll(undoTokens),
                },
                '전체 실행 취소'
              ) as React.ReactElement)
            : undefined,
        });

        onSuccess();
        return true;
      } catch (error) {
        console.error('Bulk delete error:', error);
        toast({
          title: '일괄 삭제 실패',
          description: '네트워크 오류가 발생했습니다.',
          variant: 'destructive',
        });
        return false;
      } finally {
        setIsDeleting(false);
      }
    },
    [tableName, onSuccess, toast]
  );

  const undoAll = useCallback(
    async (undoTokens: string[]) => {
      let successCount = 0;
      let failCount = 0;

      for (const token of undoTokens) {
        try {
          const res = await fetch(
            `/api/admin/data-quality-console/undo/${token}`,
            { method: 'POST' }
          );
          if (res.ok) {
            successCount++;
          } else {
            failCount++;
          }
        } catch {
          failCount++;
        }
      }

      if (failCount === 0) {
        toast({
          title: '전체 복원 완료',
          description: `${successCount}개 항목이 복원되었습니다.`,
        });
      } else {
        toast({
          title: '부분 복원',
          description: `${successCount}개 복원 성공, ${failCount}개 실패`,
          variant: 'destructive',
        });
      }

      onSuccess();
    },
    [onSuccess, toast]
  );

  return { bulkDelete, isDeleting };
}
