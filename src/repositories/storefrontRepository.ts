import StorefrontSettings from "../models/StorefrontSettings";

export const storefrontRepository = {
  async getDefaultSettingsLean() {
    return StorefrontSettings.findOne({ key: "default" }).lean();
  },
};
