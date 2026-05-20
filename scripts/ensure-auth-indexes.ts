/**
 * Run after deploy: npx ts-node --transpile-only scripts/ensure-auth-indexes.ts
 * Ensures auth-related MongoDB indexes (safe to re-run).
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../src/config/db";
import AuthOtp from "../src/models/AuthOtp";
import RefreshToken from "../src/models/RefreshToken";
import User from "../src/models/User";
import OtpSendLog from "../src/models/OtpSendLog";

async function main() {
  await connectDB();
  await Promise.all([
    AuthOtp.syncIndexes(),
    RefreshToken.syncIndexes(),
    User.syncIndexes(),
    OtpSendLog.syncIndexes(),
  ]);
  console.log("Auth indexes synchronized.");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
