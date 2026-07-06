import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Field-level encryption for PII (bank account numbers, etc.).
 * AES-256-GCM with a random IV per value; format: iv.tag.ciphertext (hex).
 * The key lives only in env/secret manager — never in the database.
 */
@Injectable()
export class PiiCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('PII_ENCRYPTION_KEY'), 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${ciphertext.toString('hex')}`;
  }

  decrypt(encoded: string): string {
    const [ivHex, tagHex, dataHex] = encoded.split('.');
    if (!ivHex || !tagHex || !dataHex) throw new Error('malformed encrypted value');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Last 4 digits for display — the only thing list endpoints ever return. */
  mask(accountNumber: string): string {
    return `••••••${accountNumber.slice(-4)}`;
  }
}
