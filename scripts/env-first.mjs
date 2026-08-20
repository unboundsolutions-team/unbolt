/**
 * Side-effecting import that loads .env.local before anything else.
 *
 * ES module imports are all evaluated before the importing module's own top
 * level runs, so calling loadEnvFiles() as a statement is too late for any
 * module that reads the environment while it is being evaluated. Importing this
 * FIRST is the only ordering that reliably works.
 *
 *   import "./env-first.mjs";   // must be the first import
 *   import { db } from "../src/db/client";
 */
import { loadEnvFiles } from "./env-file.mjs";

loadEnvFiles();
