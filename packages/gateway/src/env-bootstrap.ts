/**
 * Load repo-root `.env` before any other gateway code reads `process.env`.
 */
import path from 'path';
import { config } from 'dotenv';

const envPath = path.resolve(__dirname, '../../../.env');
config({ path: envPath });
