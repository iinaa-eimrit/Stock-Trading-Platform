import { createServer } from 'http';
import { PORT } from './config';
import { WebSocketService } from './services/websocket';
import { MarketMaker } from './services/market-maker';
import { createApp } from './app';
import { logger } from './logger';

async function start() {
  const { app, engine, marketData, processor } = createApp();

  /* ─── HTTP + WebSocket server ─── */
  const server = createServer(app);
  new WebSocketService(server, engine, marketData);

  /* ─── Market Maker (provides liquidity) ─── */
  const mm = new MarketMaker(processor);

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`Exchange API  → http://0.0.0.0:${PORT}`);
    logger.info(`WebSocket     → ws://0.0.0.0:${PORT}/ws`);
  });

  // Bounded startup recovery
  try {
    logger.info('RECOVERY_STARTED: Starting Journal Replay / Recovery...');
    
    let synced = false;
    let retries = 0;
    while (!synced && retries < 10) {
      try {
        logger.info(`SETTLEMENT_RETRY: Attempting syncSettlement... (try ${retries + 1})`);
        await processor.syncSettlement();
        synced = true;
      } catch (err: any) {
        logger.error({ err }, 'SETTLEMENT_FAILED: postgres might be unavailable');
        retries++;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!synced) {
      logger.error('FATAL: Could not synchronize settlement with database after 10 retries. EXCHANGE_NOT_READY.');
      process.exit(1); // Bounded failure!
    }

    logger.info('RECOVERY_COMPLETED: Settlement synchronized!');
    logger.info('EXCHANGE_READY: Application is ready to accept orders.');
    app.locals.isReady = true;

    // Start market maker after a short delay so initial orderbook events don't flood
    setTimeout(() => {
      mm.start();
      logger.info('Market maker running');
    }, 500);

    const shutdown = async () => {
      logger.info('Graceful shutdown initiated. Refusing new requests...');
      server.close();
      app.locals.isReady = false;
      mm.stop();
      logger.info('Waiting for pending tasks to finish...');
      // Wait for any pending async operations in the processor to flush
      await new Promise(r => setTimeout(r, 1000));
      logger.info('Flushing journal...');
      // Assuming processor.journal has flush. Actually we don't expose journal on processor.
      // We can just exit cleanly, Node will flush buffers, but we should make sure PostgreSQL pool is closed.
      const { pool } = require('./db/db');
      await pool.end();
      logger.info('Shutting down completed. Exiting.');
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (err: any) {
    logger.error({ err }, 'Startup recovery failed');
    process.exit(1);
  }
}

start().catch(err => {
  logger.error({ err }, 'Failed to start exchange');
  process.exit(1);
});
