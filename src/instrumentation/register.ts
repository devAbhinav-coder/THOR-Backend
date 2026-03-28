import { assertRequiredEnv } from "../config/env";
import { initSentry } from "./sentryInit";

assertRequiredEnv();
initSentry();
