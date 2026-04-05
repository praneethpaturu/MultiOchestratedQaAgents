import winston from "winston";
import path from "path";
import fs from "fs";
import { config } from "../config/index.js";

const logDir = path.resolve(process.cwd(), config.logging.dir);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const colorize = winston.format.colorize();
const timestamp = winston.format.timestamp({ format: "HH:mm:ss" });

export const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    timestamp,
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
    }),
    new winston.transports.File({
      filename: path.join(logDir, "combined.log"),
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        timestamp,
        winston.format.printf(({ level, message, timestamp: ts, agent }) => {
          const prefix = agent ? `[${agent}]` : "";
          return colorize.colorize(
            level,
            `${ts} ${level.toUpperCase().padEnd(5)} ${prefix} ${message}`
          );
        })
      ),
    }),
  ],
});

export function agentLogger(agentName: string) {
  return logger.child({ agent: agentName });
}
