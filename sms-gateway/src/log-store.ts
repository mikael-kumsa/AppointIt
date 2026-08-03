import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SmsRecord } from "./types.js";

export class SmsLogStore {
  constructor(private readonly logFile: string) {}

  async append(record: SmsRecord): Promise<void> {
    await mkdir(dirname(this.logFile), { recursive: true });
    await writeFile(this.logFile, `${JSON.stringify(record)}\n`, { flag: "a" });
  }

  async list(limit = 100): Promise<SmsRecord[]> {
    const max = Math.max(1, Math.min(limit, 500));
    const records = await this.readAll();
    return records.slice(-max).reverse();
  }

  async findById(id: string): Promise<SmsRecord | null> {
    const records = await this.readAll();
    for (let index = records.length - 1; index >= 0; index -= 1) {
      if (records[index].id === id) {
        return records[index];
      }
    }

    return null;
  }

  private async readAll(): Promise<SmsRecord[]> {
    try {
      const content = await readFile(this.logFile, "utf8");
      return content
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as SmsRecord);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }
}

export async function atomicWriteFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, path);
}
