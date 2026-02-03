'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/lib/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import React from 'react';

interface UseDeleteRowOptions {
  tableName: string;
  onSuccess: () => void;
}

interface DeleteRowResult {
  matchCount?: number;
}

export function useDeleteRow({ tableName, onSuccess }: UseDeleteRowOptions) {
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  const deleteRow = useCallback(
    async (id: string): Promise<DeleteRowResult | null> => {
      setIsDeleting(true);
      try {
        const res = await fetch(
          `/api/admin/data-quality-console/${tableName}/${id}`,
          { method: 'DELETE' }
        );

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast({
            title: '삭제 실패',
            description: body.error || '알 수 없는 오류가 발생했습니다.',
            variant: 'destructive',
          });
          return null;
        }

        const data = await res.json();

        toast({
          title: '삭제 완료',
          description: data.message || '항목이 삭제되었습니다.',
          action: data.undoToken
            ? (React.createElement(
                ToastAction,
                {
                  altText: '실행 취소',
                  onClick: () => undoDelete(data.undoToken),
                },
                '실행 취소'
              ) as React.ReactElement)
            : undefined,
        });

        onSuccess();
        return { matchCount: data.matchCount };
      } catch (error) {
        console.error('Delete error:', error);
        toast({
          title: '삭제 실패',
          description: '네트워크 오류가 발생했습니다.',
          variant: 'destructive',
        });
        return null;
      } finally {
        setIsDeleting(false);
      }
    },
    [tableName, onSuccess, toast]
  );

  const undoDelete = useCallback(
    async (undoToken: string) => {
      try {
        const res = await fetch(
          `/api/admin/data-quality-console/undo/${undoToken}`,
          { method: 'POST' }
        );

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast({
            title: '실행 취소 실패',
            description:
              body.error || '실행 취소할 수 없습니다.',
            variant: 'destructive',
          });
          return;
        }

        toast({
          title: '복원 완료',
          description: '삭제가 취소되었습니다.',
        });

        onSuccess();
      } catch (error) {
        console.error('Undo error:', error);
        toast({
          title: '실행 취소 실패',
          description: '네트워크 오류가 발생했습니다.',
          variant: 'destructive',
        });
      }
    },
    [onSuccess, toast]
  );

  return { deleteRow, undoDelete, isDeleting };
}
