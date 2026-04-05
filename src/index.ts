#!/usr/bin/env node

import { createCLI } from "./orchestrator/cli.js";

const cli = createCLI();
cli.parse(process.argv);
