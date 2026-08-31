import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { MatchingEngine } from '../engine/matching-engine';
import { MarketDataService } from './market-data';

interface Client {
  ws: WebSocket;
  subs: Set<string>;
}

export class WebSocketService {
  private clients = new Set<Client>();

  constructor(server: Server, engine: MatchingEngine, marketData: MarketDataService) {
    const wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws) => {
      const client: Client = { ws, subs: new Set() };
      this.clients.add(client);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.method === 'subscribe' && Array.isArray(msg.params)) {
            for (const ch of msg.params) {
              if (typeof ch === 'string') client.subs.add(ch);
            }
            this.sendSnapshots(client, msg.params, engine, marketData);
          } else if (msg.method === 'unsubscribe' && Array.isArray(msg.params)) {
            for (const ch of msg.params) client.subs.delete(ch);
          }
        } catch {
          /* ignore malformed messages */
        }
      });

      ws.on('close', () => this.clients.delete(client));
      ws.on('error', () => this.clients.delete(client));
    });

    // Forward engine events (disabled in Phase 4 due to synchronous architecture)
    // engine.on('trades', ({ market, trades }) => {
    //   this.broadcast(`trades@${market}`, trades);
    // });

    // engine.on('orderbook', ({ market, book }) => {
    //   this.broadcast(`orderbook@${market}`, book);
    // });

    // engine.on('ticker', ({ market, price, timestamp }) => {
    //   this.broadcast(`ticker@${market}`, { price, timestamp });
    // });

    marketData.on('candle', ({ market, interval, candle }) => {
      this.broadcast(`candles@${market}@${interval}`, candle);
    });
  }

  private broadcast(stream: string, data: unknown): void {
    const msg = JSON.stringify({ stream, data });
    for (const c of this.clients) {
      if (c.subs.has(stream) && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(msg);
      }
    }
  }

  private sendSnapshots(
    client: Client,
    channels: string[],
    engine: MatchingEngine,
    marketData: MarketDataService
  ): void {
    for (const ch of channels) {
      if (typeof ch !== 'string') continue;
      const parts = ch.split('@');
      const [type, market, extra] = parts;

      if (type === 'orderbook' && market) {
        const book = engine.getOrderbook(market);
        if (book) this.send(client, ch, book);
      } else if (type === 'trades' && market) {
        this.send(client, ch, engine.getRecentTrades(market));
      } else if (type === 'candles' && market && extra) {
        this.send(client, `${ch}:snapshot`, marketData.getCandles(market, extra));
      }
    }
  }

  private send(client: Client, stream: string, data: unknown): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({ stream, data }));
    }
  }
}
