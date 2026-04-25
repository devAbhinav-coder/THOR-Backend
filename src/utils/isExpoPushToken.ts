/**
 * Same rules as `Expo.isExpoPushToken` from expo-server-sdk, without importing that ESM package
 * at module load time (CommonJS backend).
 */
export function isExpoPushToken(token: unknown): boolean {
  if (typeof token !== "string") return false;
  return (
    ((token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[")) &&
      token.endsWith("]")) ||
    /^[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{12}$/i.test(token)
  );
}
