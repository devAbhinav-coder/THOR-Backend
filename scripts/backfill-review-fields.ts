/**
 * Backfill review subsystem fields after deploy.
 *
 * Run: npx ts-node --transpile-only scripts/backfill-review-fields.ts
 * Or:  npm run backfill:review-fields
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../src/config/db';
import Review from '../src/models/Review';

async function main() {
  await connectDB();

  const helpfulCountResult = await Review.updateMany(
    {
      $or: [
        { helpfulCount: { $exists: false } },
        { helpfulCount: null },
      ],
    },
    [
      {
        $set: {
          helpfulCount: { $size: { $ifNull: ['$helpfulVotes', []] } },
        },
      },
    ]
  );

  const statusResult = await Review.updateMany(
    { status: { $exists: false } },
    { $set: { status: 'visible' } }
  );

  const deletedAtResult = await Review.updateMany(
    { deletedAt: { $exists: false } },
    { $set: { deletedAt: null } }
  );

  await Review.syncIndexes();

  const productIds = await Review.distinct('product');
  const ReviewModel = Review as typeof Review & {
    calcAverageRatings: (id: mongoose.Types.ObjectId) => Promise<void>;
  };

  let recalculated = 0;
  for (const productId of productIds) {
    await ReviewModel.calcAverageRatings(productId as mongoose.Types.ObjectId);
    recalculated += 1;
  }

  console.log('Review backfill complete.');
  console.log({
    helpfulCountUpdated: helpfulCountResult.modifiedCount,
    statusDefaulted: statusResult.modifiedCount,
    deletedAtDefaulted: deletedAtResult.modifiedCount,
    productRatingsRecalculated: recalculated,
  });

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
