import pino, { type LoggerOptions } from 'pino';
import { env } from '../config/env';

const options: LoggerOptions =
  env.NODE_ENV === 'development'
    ? {
        level: 'debug',
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {
        level: 'info',
      };

export const logger = pino(options);
