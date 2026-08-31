import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

describe('Readiness Probe Failure States', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.locals.isReady = false;
    app.locals.journalSequence = undefined;
    app.locals.settledSequence = undefined;
    app.locals.settlementBacklog = undefined;

    app.get('/ready', (req, res) => {
      // Simulate checking Postgres
      if (app.locals.postgresUnavailable) {
        return res.status(503).json({ status: 'syncing', error: 'Postgres unavailable' });
      }

      if (app.locals.isReady) {
        // Enforce strict catch-up if explicitly defined
        if (app.locals.settlementBacklog > 0) {
          return res.status(503).json({ status: 'syncing', backlog: app.locals.settlementBacklog });
        }

        res.json({ 
          status: 'ready',
          journalSequence: app.locals.journalSequence !== undefined ? String(app.locals.journalSequence) : undefined,
          settledSequence: app.locals.settledSequence !== undefined ? String(app.locals.settledSequence) : undefined,
          settlementBacklog: app.locals.settlementBacklog
        });
      } else {
        res.status(503).json({ status: 'syncing' });
      }
    });
  });

  it('should return 503 when journal recovery is incomplete', async () => {
    app.locals.isReady = false;
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('syncing');
  });

  it('should return 503 when Postgres is unavailable', async () => {
    app.locals.isReady = false;
    app.locals.postgresUnavailable = true;
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Postgres unavailable');
  });

  it('should return 503 when settlement backlog > 0 even if marked ready', async () => {
    app.locals.isReady = true;
    app.locals.settlementBacklog = 100; // Simulated backlog
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.backlog).toBe(100);
  });

  it('should return 200 when journal and DB are synchronized', async () => {
    app.locals.isReady = true;
    app.locals.journalSequence = 12000n;
    app.locals.settledSequence = 12000n;
    app.locals.settlementBacklog = 0;
    
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    // Note: express sends bigints as json if configured, but let's just check strings if they are serialized
  });
});
