import 'server-only';
import pino from 'pino';

const REDACT = [
  'password',
  '*.password',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'headers.cookie',
  'headers.authorization',
  'phone',
  '*.phone',
  'contactPhone',
  '*.contactPhone',
  'addressText',
  '*.addressText',
  'line1',
  '*.line1',
  'card',
  '*.card',
  'otp',
  '*.otp',
  'licenseNumber',
  '*.licenseNumber',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'foodz' },
  redact: { paths: REDACT, censor: '[redacted]' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
