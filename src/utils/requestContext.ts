import { AsyncLocalStorage } from "async_hooks";

export interface RequestContextStore {
  requestId: string;
  ip: string;
}

export const requestContext = new AsyncLocalStorage<RequestContextStore>();

export function getRequestContext(): RequestContextStore | undefined {
  return requestContext.getStore();
}
