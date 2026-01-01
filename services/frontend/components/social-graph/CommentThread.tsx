'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MessageSquare, Loader2, AlertCircle, Languages, RotateCcw } from 'lucide-react';
import { useCommentThread } from '@/hooks/useSocialGraph';
import { translateComment, TranslateCommentResponse } from '@/lib/api';

interface CommentThreadProps {
  messageId: number;
}

interface CommentItemProps {
  comment: any;
  onTranslationUpdate: (commentId: number, translation: TranslateCommentResponse) => void;
}

function CommentItem({ comment, onTranslationUpdate }: CommentItemProps) {
  const [isTranslating, setIsTranslating] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasTranslation = !!comment.translated_content;
  const displayContent = showOriginal || !hasTranslation
    ? comment.content
    : comment.translated_content;

  const handleTranslate = async () => {
    setIsTranslating(true);
    setError(null);
    try {
      const result = await translateComment(comment.id);
      onTranslationUpdate(comment.id, result);
    } catch (err: any) {
      setError(err.message || 'Translation failed');
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div className="border-l-2 border-muted pl-4 py-2">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-xs text-muted-foreground">
          User {comment.author_user_id || 'Anonymous'}
        </span>
        {comment.created_at && (
          <span className="text-xs text-muted-foreground">
            • {new Date(comment.created_at).toLocaleString()}
          </span>
        )}
        {comment.reactions_count > 0 && (
          <span className="text-xs text-muted-foreground">
            • {comment.reactions_count} reactions
          </span>
        )}
        {hasTranslation && comment.original_language && comment.original_language !== 'en' && (
          <span className="text-xs text-blue-500 dark:text-blue-400">
            • {comment.original_language.toUpperCase()} → EN
          </span>
        )}
      </div>

      <p className="text-sm text-foreground">{displayContent}</p>

      {comment.is_reply && (
        <span className="text-xs text-muted-foreground italic">
          Reply to comment #{comment.reply_to_comment_id}
        </span>
      )}

      {/* Translation controls */}
      <div className="flex items-center gap-2 mt-2">
        {!hasTranslation && comment.content && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTranslate}
            disabled={isTranslating}
            className="h-6 px-2 text-xs"
          >
            {isTranslating ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Translating...
              </>
            ) : (
              <>
                <Languages className="h-3 w-3 mr-1" />
                Translate
              </>
            )}
          </Button>
        )}

        {hasTranslation && comment.original_language !== 'en' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowOriginal(!showOriginal)}
            className="h-6 px-2 text-xs"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            {showOriginal ? 'Show translation' : 'Show original'}
          </Button>
        )}

        {hasTranslation && comment.translation_method && comment.translation_method !== 'none' && (
          <span className="text-xs text-muted-foreground">
            via {comment.translation_method.replace('_', ' ')}
          </span>
        )}

        {error && (
          <span className="text-xs text-destructive">{error}</span>
        )}
      </div>
    </div>
  );
}

export function CommentThread({ messageId }: CommentThreadProps) {
  const { data, isLoading, error } = useCommentThread(messageId, {
    limit: 50,
    sort: 'asc',
    include_replies: true,
  });

  // Local state for optimistic updates
  const [localTranslations, setLocalTranslations] = useState<Record<number, TranslateCommentResponse>>({});

  const handleTranslationUpdate = (commentId: number, translation: TranslateCommentResponse) => {
    setLocalTranslations(prev => ({
      ...prev,
      [commentId]: translation,
    }));
  };

  if (isLoading) {
    return (
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Comments & Discussion
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading comments...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Comments & Discussion
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <AlertCircle className="h-8 w-8 mx-auto text-destructive mb-2" />
            <p className="text-sm text-muted-foreground">Failed to load comments</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Merge server data with local translations
  const comments = (data?.comments || []).map((comment: any) => {
    const localTranslation = localTranslations[comment.id];
    if (localTranslation) {
      return {
        ...comment,
        translated_content: localTranslation.translated_content,
        original_language: localTranslation.original_language,
        translation_method: localTranslation.translation_method,
      };
    }
    return comment;
  });

  const hasComments = comments.length > 0;

  return (
    <Card className="dark:border-gray-700">
      <CardHeader className="pb-3 dark:border-gray-700">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          Comments & Discussion
          {data?.pagination?.total ? (
            <span className="text-xs text-muted-foreground ml-auto">
              {data.pagination.total} {data.pagination.total === 1 ? 'comment' : 'comments'}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasComments ? (
          <div className="text-center py-12 space-y-4">
            <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground/20 mb-3" />
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">
                No Comments Yet
              </p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                This channel does not have a linked discussion group, or no comments have been posted yet.
              </p>
            </div>
            {data?.metadata && (
              <div className="bg-muted/50 dark:bg-muted/20 rounded-lg p-4 max-w-md mx-auto text-left">
                <p className="text-xs font-medium mb-2">About Comment Tracking:</p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Comments are from Telegram discussion groups linked to channels</li>
                  <li>Not all channels have discussion groups enabled</li>
                  <li>Comments are captured during message archival</li>
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {comments.map((comment: any) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onTranslationUpdate={handleTranslationUpdate}
              />
            ))}

            {data?.pagination?.has_more && (
              <div className="text-center pt-4">
                <p className="text-xs text-muted-foreground">
                  Showing {comments.length} of {data.pagination.total} comments
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
