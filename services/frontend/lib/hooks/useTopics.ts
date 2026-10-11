'use client';

import { useState, useEffect } from 'react';
import { adminApi } from '@/lib/admin-api';

export interface Topic {
  id: number;
  name: string;
  label: string;
  color: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  message_count: number;
}

export function useTopics() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTopics() {
      try {
        const data = await adminApi.get('/api/admin/topics/');
        setTopics(data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load topics');
        // Fallback to empty array
        setTopics([]);
      } finally {
        setLoading(false);
      }
    }

    fetchTopics();
  }, []);

  // For select dropdowns: includes empty option
  const topicOptions = [
    { value: '', label: '—' },
    ...topics.map(t => ({ value: t.name, label: t.label })),
  ];

  return { topics, topicOptions, loading, error };
}
