import OfflineCustomer from "../models/OfflineCustomer";
import { normalizeIndianMobile10 } from "../types/utils/indianPhone";

/** Upsert the POS marketing row for this email (deduped by unique email). */
export async function upsertOfflineCustomerRecord(params: {
  email: string;
  phone: string;
  name: string;
}): Promise<void> {
  const email = params.email.trim().toLowerCase();
  const name = params.name.trim().slice(0, 80);
  const phone = normalizeIndianMobile10(params.phone);
  if (!email || !phone) return;

  await OfflineCustomer.findOneAndUpdate(
    { email },
    {
      $set: {
        email,
        phone,
        name: name || email.split("@")[0] || "Customer",
        lastOfflineOrderAt: new Date(),
      },
      $inc: { offlineOrderCount: 1 },
    },
    { upsert: true, runValidators: true },
  );
}

export async function removeOfflineCustomerByEmail(emailRaw: string): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  if (!email) return;
  await OfflineCustomer.deleteMany({ email });
}
