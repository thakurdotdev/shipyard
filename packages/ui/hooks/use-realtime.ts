'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

// Feature flag - set via env var
const USE_SSE = process.env.NEXT_PUBLIC_USE_SSE === 'true';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface BuildLogEvent {
  buildId: string;
  data: string;
  level?: string;
}

interface BuildUpdateEvent {
  id: string;
  status: string;
  [key: string]: any;
}

/**
 * Hook for subscribing to build logs via SSE or Socket.IO
 */
export function useBuildLogs(buildId: string, onLog: (message: string, level: string) => void) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!buildId) return;

    if (USE_SSE) {
      // SSE approach
      // Get session token from cookie
      const token = document.cookie
        .split('; ')
        .find((row) => row.startsWith('better-auth.session_token='))
        ?.split('=')[1];

      const url = `${API_URL}/builds/${buildId}/stream${token ? `?token=${token}` : ''}`;
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.addEventListener('build_log', (event) => {
        try {
          const data = JSON.parse(event.data);
          onLog(data.data, data.level || 'info');
        } catch {
          onLog(event.data, 'info');
        }
      });

      eventSource.addEventListener('connected', () => {
        console.log('[SSE] Connected to build logs');
      });

      eventSource.onerror = () => {
        console.log('[SSE] Connection error, will auto-reconnect');
      };

      return () => {
        eventSource.close();
        eventSourceRef.current = null;
      };
    } else {
      // Socket.IO fallback
      const socket = io(API_URL);
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('subscribe_build', buildId);
      });

      socket.on('build_log', (message: BuildLogEvent) => {
        if (message.buildId === buildId) {
          onLog(message.data, message.level || 'info');
        }
      });

      return () => {
        socket.emit('unsubscribe_build', buildId);
        socket.disconnect();
        socketRef.current = null;
      };
    }
  }, [buildId, onLog]);
}

/**
 * Hook for subscribing to project updates via SSE or Socket.IO
 */
export function useProjectUpdates(
  projectId: string,
  callbacks: {
    onBuildUpdated?: (build: BuildUpdateEvent) => void;
    onDeploymentUpdated?: () => void;
  },
) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!projectId) return;

    if (USE_SSE) {
      // SSE approach for project updates
      // Get session token from cookie
      const token = document.cookie
        .split('; ')
        .find((row) => row.startsWith('better-auth.session_token='))
        ?.split('=')[1];

      const url = `${API_URL}/projects/${projectId}/stream${token ? `?token=${token}` : ''}`;
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.addEventListener('build_updated', (event) => {
        try {
          const data = JSON.parse(event.data);
          callbacks.onBuildUpdated?.(data);
        } catch (e) {
          console.error('[SSE] Failed to parse build_updated', e);
        }
      });

      eventSource.addEventListener('deployment_updated', () => {
        callbacks.onDeploymentUpdated?.();
      });

      return () => {
        eventSource.close();
        eventSourceRef.current = null;
      };
    } else {
      // Socket.IO fallback
      const socket = io(API_URL);
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('subscribe_project', projectId);
      });

      socket.on('build_updated', (build: BuildUpdateEvent) => {
        callbacks.onBuildUpdated?.(build);
      });

      socket.on('deployment_updated', () => {
        callbacks.onDeploymentUpdated?.();
      });

      return () => {
        socket.emit('unsubscribe_project', projectId);
        socket.disconnect();
        socketRef.current = null;
      };
    }
  }, [projectId, callbacks.onBuildUpdated, callbacks.onDeploymentUpdated]);
}

/**
 * Check if using SSE
 */
export function isUsingSSE(): boolean {
  return USE_SSE;
}
