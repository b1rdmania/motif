import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { ScoreUtils } from '../utils/ScoreUtils.js';
import { SimpleMIDI } from '../utils/SimpleMIDI.js';
import type { CacheEntry } from '../types.js';

export class MIDIFetchService {
  private cacheDir = path.join(process.cwd(), 'cache');
  private cacheIndex = new Map<string, CacheEntry>();

  constructor() {
    this.initializeCache();
  }

  async fetch(url: string): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> {
    try {
      // Only generate synthetic MIDI for explicit synthetic URLs or when enabled
      if (url.startsWith('synthetic:') || url.includes('mock') || 
          (process.env.USE_SYNTHETIC_FETCH === '1')) {
        console.log(`Generating synthetic MIDI for: ${url}`);
        const songName = url.startsWith('synthetic:') 
          ? url.replace('synthetic:', '') 
          : url.split('/').pop()?.replace('.mid', '') || 'test';
        
        const syntheticBuffer = SimpleMIDI.generateValidMIDI(songName);
        console.log(`Generated ${syntheticBuffer.byteLength} bytes of synthetic MIDI data`);
        return { success: true, data: syntheticBuffer };
      }

      const target = await this.validateTargetUrl(url);
      if (!target.valid) {
        return { success: false, error: target.error };
      }

      // Check cache first
      const hash = this.hashUrl(url);
      const cached = await this.getCached(hash);
      if (cached) {
        console.log(`Cache hit for ${url}`);
        return { success: true, data: cached };
      }

      // Fetch from network
      console.log(`Fetching from network: ${url}`);
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MotifBot/1.0)',
        },
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const buffer = await response.arrayBuffer();
      
      // Validate file
      const validation = this.validateMIDI(buffer);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Quality check
      const quality = ScoreUtils.assessQuality(buffer);
      if (quality.score < 0.3) {
        return { 
          success: false, 
          error: `Poor quality: ${quality.issues.join(', ')}` 
        };
      }

      // Cache the file
      await this.cacheFile(hash, buffer, url);
      
      return { success: true, data: buffer };
      
    } catch (error) {
      console.error('Fetch error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  private validateMIDI(buffer: ArrayBuffer): { valid: boolean; error?: string } {
    if (buffer.byteLength < 14) {
      return { valid: false, error: 'File too small to be valid MIDI' };
    }

    // Check MIDI header
    const view = new Uint8Array(buffer);
    const header = String.fromCharCode(...view.slice(0, 4));
    
    if (header !== 'MThd') {
      return { valid: false, error: 'Invalid MIDI header' };
    }

    // Size limits
    if (buffer.byteLength > 10_000_000) { // 10MB max
      return { valid: false, error: 'File too large' };
    }

    return { valid: true };
  }

  private async validateTargetUrl(rawUrl: string): Promise<{ valid: boolean; error?: string }> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { valid: false, error: 'Invalid URL' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'Only http/https URLs are allowed' };
    }

    if (parsed.username || parsed.password) {
      return { valid: false, error: 'URLs with embedded credentials are not allowed' };
    }

    const hostname = parsed.hostname.trim().toLowerCase();
    if (!hostname) {
      return { valid: false, error: 'Missing hostname' };
    }

    if (this.isBlockedHostname(hostname)) {
      return { valid: false, error: 'Blocked hostname' };
    }

    // If hostname is a literal IP, validate directly.
    if (net.isIP(hostname)) {
      if (this.isPrivateOrLocalIp(hostname)) {
        return { valid: false, error: 'Blocked target IP' };
      }
      return { valid: true };
    }

    try {
      const resolved = await dns.lookup(hostname, { all: true });
      if (resolved.length === 0) {
        return { valid: false, error: 'Unable to resolve hostname' };
      }

      // Require every resolved IP to be public routable.
      for (const entry of resolved) {
        if (this.isPrivateOrLocalIp(entry.address)) {
          return { valid: false, error: 'Blocked target IP' };
        }
      }
    } catch {
      return { valid: false, error: 'Unable to resolve hostname' };
    }

    return { valid: true };
  }

  private isBlockedHostname(hostname: string): boolean {
    return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local');
  }

  private isPrivateOrLocalIp(ip: string): boolean {
    if (net.isIPv4(ip)) {
      return this.isPrivateOrLocalIPv4(ip);
    }
    if (net.isIPv6(ip)) {
      return this.isPrivateOrLocalIPv6(ip);
    }
    return true;
  }

  private isPrivateOrLocalIPv4(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return true;
    }

    const [a, b] = parts;

    if (a === 10) return true;                     // 10.0.0.0/8
    if (a === 127) return true;                    // 127.0.0.0/8 loopback
    if (a === 0) return true;                      // 0.0.0.0/8 "this host"
    if (a === 169 && b === 254) return true;       // 169.254.0.0/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;       // 192.168.0.0/16
    if (a >= 224) return true;                     // multicast/reserved

    return false;
  }

  private isPrivateOrLocalIPv6(ip: string): boolean {
    const normalized = ip.toLowerCase();
    if (normalized === '::1') return true;         // loopback
    if (normalized === '::') return true;          // unspecified
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA fc00::/7
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
      return true; // link-local fe80::/10
    }
    if (normalized.startsWith('ff')) return true;  // multicast ff00::/8
    return false;
  }

  private hashUrl(url: string): string {
    return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
  }

  private async initializeCache(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      
      // Load cache index if it exists
      const indexPath = path.join(this.cacheDir, 'index.json');
      try {
        const indexData = await fs.readFile(indexPath, 'utf-8');
        const entries = JSON.parse(indexData) as CacheEntry[];
        for (const entry of entries) {
          this.cacheIndex.set(entry.hash, entry);
        }
        console.log(`Loaded ${entries.length} cache entries`);
      } catch {
        // Index doesn't exist yet, that's fine
      }
    } catch (error) {
      console.error('Cache initialization failed:', error);
    }
  }

  private async getCached(hash: string): Promise<ArrayBuffer | null> {
    const entry = this.cacheIndex.get(hash);
    if (!entry) return null;

    // Check if file still exists
    const filePath = path.join(this.cacheDir, entry.filename);
    try {
      const buffer = await fs.readFile(filePath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } catch {
      // File doesn't exist, remove from index
      this.cacheIndex.delete(hash);
      return null;
    }
  }

  private async cacheFile(hash: string, buffer: ArrayBuffer, originalUrl: string): Promise<void> {
    try {
      const filename = `${hash}.mid`;
      const filePath = path.join(this.cacheDir, filename);
      
      await fs.writeFile(filePath, new Uint8Array(buffer));
      
      const entry: CacheEntry = {
        hash,
        filename,
        size: buffer.byteLength,
        timestamp: Date.now()
      };
      
      this.cacheIndex.set(hash, entry);
      await this.saveIndex();
      
      console.log(`Cached ${originalUrl} as ${filename} (${buffer.byteLength} bytes)`);
    } catch (error) {
      console.error('Cache write failed:', error);
    }
  }

  private async saveIndex(): Promise<void> {
    try {
      const indexPath = path.join(this.cacheDir, 'index.json');
      const entries = Array.from(this.cacheIndex.values());
      await fs.writeFile(indexPath, JSON.stringify(entries, null, 2));
    } catch (error) {
      console.error('Cache index save failed:', error);
    }
  }
}
