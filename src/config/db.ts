import mongoose from 'mongoose';
import logger from '../utils/logger';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const connectDB = async (): Promise<void> => {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri?.trim()) {
    throw new Error('MONGODB_URI is missing. Please set it in environment variables.');
  }

  const maxRetries = parseInt(process.env.MONGODB_CONNECT_RETRIES || '10', 10);
  const retryDelayMs = parseInt(process.env.MONGODB_RETRY_DELAY_MS || '5000', 10);
  const serverSelectionTimeoutMS = parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || '12000', 10);

  let attempt = 0;
  while (attempt < maxRetries) {
    attempt += 1;
    try {
      const conn = await mongoose.connect(mongoUri, {
        maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL || '25', 10),
        serverSelectionTimeoutMS,
        socketTimeoutMS: 45000,
      });

      logger.info(`MongoDB Connected: ${conn.connection.host}`);

      mongoose.connection.on('error', (err) => {
        logger.error(`MongoDB connection error: ${err}`);
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected. Mongoose will retry automatically.');
      });
      return;
    } catch (error) {
      logger.error(
        `MongoDB connection failed (attempt ${attempt}/${maxRetries}): ${(error as Error).message}`
      );
      if (attempt >= maxRetries) {
        process.exit(1);
      }
      await sleep(retryDelayMs);
    }
  }
};

export default connectDB;
