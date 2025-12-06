import { db } from "../db";
import { environmentVariables } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "12345678901234567890123456789012"; // 32 chars

export const EnvService = {
  encrypt(text: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
  },

  decrypt(text: string) {
    if (!text.includes(":")) return text; // Handle legacy/plain text if any
    const [ivHex, authTagHex, encryptedHex] = text.split(":");
    if (!ivHex || !authTagHex || encryptedHex === undefined) return text;

    try {
      const iv = Buffer.from(ivHex, "hex");
      const authTag = Buffer.from(authTagHex, "hex");
      const decipher = createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encryptedHex, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch (e) {
      console.error("Decryption failed", e);
      return text; // Return original if decryption fails
    }
  },

  async getAll(projectId: string) {
    const vars = await db
      .select()
      .from(environmentVariables)
      .where(eq(environmentVariables.project_id, projectId));
    return vars.map((v) => ({ ...v, value: this.decrypt(v.value) }));
  },

  async getAsRecord(projectId: string) {
    const vars = await this.getAll(projectId);
    return vars.reduce((acc, v) => {
      acc[v.key] = v.value;
      return acc;
    }, {} as Record<string, string>);
  },

  async create(projectId: string, key: string, value: string) {
    const result = await db
      .insert(environmentVariables)
      .values({
        project_id: projectId,
        key,
        value: this.encrypt(value),
      })
      .onConflictDoUpdate({
        target: [environmentVariables.project_id, environmentVariables.key],
        set: { value: this.encrypt(value) },
      })
      .returning();
    return result[0];
  },

  async delete(projectId: string, key: string) {
    await db
      .delete(environmentVariables)
      .where(
        and(
          eq(environmentVariables.project_id, projectId),
          eq(environmentVariables.key, key),
        ),
      );
    return true;
  },
};
