/** Configurable BullMQ job retention — tune via env to control Redis memory. */
export const bullmqRetention = {
  removeOnComplete: Number(process.env.BULLMQ_REMOVE_ON_COMPLETE || 500),
  removeOnFail: Number(process.env.BULLMQ_REMOVE_ON_FAIL || 1000),
};

export const bullmqBroadcastRetention = {
  removeOnComplete: Number(
    process.env.BULLMQ_BROADCAST_REMOVE_ON_COMPLETE || 200,
  ),
  removeOnFail: Number(process.env.BULLMQ_BROADCAST_REMOVE_ON_FAIL || 500),
};

export const bullmqImageRetention = {
  removeOnComplete: Number(process.env.BULLMQ_IMAGE_REMOVE_ON_COMPLETE || 100),
  removeOnFail: Number(process.env.BULLMQ_IMAGE_REMOVE_ON_FAIL || 200),
};

export const bullmqPushRetention = {
  removeOnComplete: Number(process.env.BULLMQ_PUSH_REMOVE_ON_COMPLETE || 1000),
  removeOnFail: Number(process.env.BULLMQ_PUSH_REMOVE_ON_FAIL || 1000),
};

export const bullmqMaintenanceRetention = {
  removeOnComplete: Number(
    process.env.BULLMQ_MAINTENANCE_REMOVE_ON_COMPLETE || 200,
  ),
  removeOnFail: Number(process.env.BULLMQ_MAINTENANCE_REMOVE_ON_FAIL || 500),
};
