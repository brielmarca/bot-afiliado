import pino from 'pino';
import pinoPretty from 'pino-pretty';

const isDev = process.env.NODE_ENV === 'development';

const logger = isDev
  ? pino(
      { level: 'debug' },
      pinoPretty({
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      })
    )
  : pino({
      level: process.env.LOG_LEVEL || 'info',
      serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
      },
    });

export default logger;
export { logger };