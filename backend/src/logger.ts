import pino from 'pino';

// Define standard domain-specific logger interface
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  redact: {
    paths: ['password', 'token', 'authorization', 'secret', 'DATABASE_URL', 'JWT_SECRET'],
    censor: '***',
  },
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    },
  }),
});
