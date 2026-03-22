import { useEffect, useRef, useCallback } from 'react';

type MessageHandler = (stream: string, data: any) => void;

export function useWebSocket(onMessage: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const subsRef = useRef<Set<string>>(new Set());
  const handleRef = useRef(onMessage);
  handleRef.current = onMessage;

  useEffect(() => {
    let alive = true;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (subsRef.current.size > 0) {
          ws.send(JSON.stringify({ method: 'subscribe', params: [...subsRef.current] }));
        }
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.stream && msg.data !== undefined) {
            handleRef.current(msg.stream, msg.data);
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        if (alive) reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const subscribe = useCallback((channels: string[]) => {
    for (const c of channels) subsRef.current.add(c);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ method: 'subscribe', params: channels }));
    }
  }, []);

  const unsubscribe = useCallback((channels: string[]) => {
    for (const c of channels) subsRef.current.delete(c);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ method: 'unsubscribe', params: channels }));
    }
  }, []);

  return { subscribe, unsubscribe };
}
