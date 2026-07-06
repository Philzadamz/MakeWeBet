'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';

/**
 * Live feed client. WebSockets bypass the Next rewrite proxy, so this
 * connects straight to the API origin. Read-only public data; auth-free.
 */
let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    const origin = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    socket = io(`${origin}/live`, { transports: ['websocket'], reconnectionDelayMax: 10_000 });
  }
  return socket;
}

/** Join a contest room; refetch the relevant queries on every tick. */
export function useContestLive(contestId: string | undefined, slug: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!contestId || !slug) return;
    const s = getSocket();
    s.emit('join', { contestId });

    const onLeaderboard = () => {
      void queryClient.invalidateQueries({ queryKey: ['leaderboard', slug] });
    };
    const onPool = () => {
      void queryClient.invalidateQueries({ queryKey: ['contest', slug] });
      void queryClient.invalidateQueries({ queryKey: ['contests'] });
    };
    const onStatus = () => {
      onLeaderboard();
      onPool();
    };

    s.on('leaderboard:update', onLeaderboard);
    s.on('pool:update', onPool);
    s.on('contest:status', onStatus);
    return () => {
      s.emit('leave', { contestId });
      s.off('leaderboard:update', onLeaderboard);
      s.off('pool:update', onPool);
      s.off('contest:status', onStatus);
    };
  }, [contestId, slug, queryClient]);
}
