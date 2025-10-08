// lib/health.ts
import {
  initialize,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
} from "react-native-health-connect";
  
  let hcReady = false;
  
  /**
   * Initialize Health Connect and request read permission for HeartRate.
   * Lots of logs so it's obvious what's going on.
   */
  export async function ensureHCReady(): Promise<void> {
    if (hcReady) {
      console.log("[HC] Already initialized");
      return;
    }
    console.log("[HC] Initializing Health Connect…");
    await initialize();
    console.log("[HC] Requesting permission: HeartRate (read) …");
    await requestPermission([{ accessType: "read", recordType: "HeartRate" }]);
    hcReady = true;
    console.log("[HC] Ready ✅");
  }
  
  /**
   * Open Health Connect settings (with error surfaced).
   */
  export async function openHCSettings() {
    try {
      console.log("[HC] Opening Health Connect settings…");
      await openHealthConnectSettings();
    } catch (e) {
      console.log("[HC] Failed to open HC settings:", e);
      throw new Error("Unable to open Health Connect settings");
    }
  }
  
  /**
   * Return ONLY the latest single HR sample within minutesBack.
   * Enhanced to look further back and be more aggressive about finding data.
   */
  export async function readLatestBpm(
    minutesBack = 180 // Increased from 60 to 180 minutes
  ): Promise<{ bpm: number | null; at?: string }> {
    const end = new Date();
    const start = new Date(end.getTime() - minutesBack * 60 * 1000);
  
    console.log(
      `[HR] readLatestBpm(): window ${start.toISOString()} → ${end.toISOString()}`
    );
  
    let latest: { bpm: number; at: string } | null = null;
    let pageToken: string | undefined;
  
    do {
      const res: any = await readRecords("HeartRate", {
        timeRangeFilter: {
          operator: "between",
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        },
        pageSize: 1000,
        pageToken,
      });
      pageToken = res?.nextPageToken;
  
      const records = res?.records ?? [];
      console.log(
        `[HR] readLatestBpm(): got ${records.length} records; nextPageToken=${pageToken ?? "∅"}`
      );
  
      for (const rec of records) {
        const r: any = rec;
        // NOTE: r.metadata.lastModifiedTime shows when SH wrote to HC (batch hint)
        const origin =
          r?.metadata?.dataOrigin || r?.dataOrigin || r?.metadata?.packageName;
        if (Array.isArray(r.samples) && r.samples.length) {
          for (const s of r.samples) {
            const t = new Date(s.time).getTime();
            if (!latest || t > new Date(latest.at).getTime()) {
              latest = { bpm: s.beatsPerMinute, at: s.time };
            }
          }
        } else {
          const bpm =
            typeof r.beatsPerMinute === "number" ? r.beatsPerMinute : r.bpm;
          const at = r.endTime ?? r.startTime;
          if (typeof bpm === "number" && at) {
            const t = new Date(at).getTime();
            if (!latest || t > new Date(latest.at).getTime()) {
              latest = { bpm, at };
            }
          }
        }
        console.log(
          `[HR] record id=${r?.metadata?.id ?? "?"} origin=${origin ?? "?"} samples=${Array.isArray(r.samples) ? r.samples.length : (r.beatsPerMinute ? 1 : 0)} lastModified=${r?.metadata?.lastModifiedTime ?? "?"}`
        );
      }
    } while (pageToken);
  
    console.log("[HR] readLatestBpm(): result", latest);
    return { bpm: latest?.bpm ?? null, at: latest?.at };
  }
  
  /**
   * Get ALL samples in a window (for listing/plotting).
   * Sorted newest→oldest. Loud logging so you see batch arrivals.
   */
  export async function readHeartRateSeries(
    minutesBack = 60
  ): Promise<{ bpm: number; at: string }[]> {
    const end = new Date();
    const start = new Date(end.getTime() - minutesBack * 60 * 1000);
    console.log(
      `[HR] readHeartRateSeries(): window ${start.toISOString()} → ${end.toISOString()}`
    );
  
    const out: { bpm: number; at: string }[] = [];
    let pageToken: string | undefined;
  
    do {
      const res: any = await readRecords("HeartRate", {
        timeRangeFilter: {
          operator: "between",
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        },
        pageSize: 1000,
        pageToken,
      });
  
      const records = res?.records ?? [];
      pageToken = res?.nextPageToken;
      console.log(
        `[HR] readHeartRateSeries(): got ${records.length} records; nextPageToken=${pageToken ?? "∅"}`
      );
  
      for (const rec of records) {
        const r: any = rec;
        const batchLM = r?.metadata?.lastModifiedTime;
        const origin =
          r?.metadata?.dataOrigin || r?.dataOrigin || r?.metadata?.packageName;
  
        if (Array.isArray(r.samples) && r.samples.length) {
          for (const s of r.samples) {
            out.push({ bpm: s.beatsPerMinute, at: s.time });
          }
          console.log(
            `[HR] series-record id=${r?.metadata?.id ?? "?"} origin=${origin ?? "?"} samples=${r.samples.length} lastModified=${batchLM ?? "?"}`
          );
        } else {
          const bpm =
            typeof r.beatsPerMinute === "number" ? r.beatsPerMinute : r.bpm;
          const at = r.endTime ?? r.startTime;
          if (typeof bpm === "number" && at) {
            out.push({ bpm, at });
            console.log(
              `[HR] single-record id=${r?.metadata?.id ?? "?"} origin=${origin ?? "?"} bpm=${bpm} at=${at} lastModified=${batchLM ?? "?"}`
            );
          }
        }
      }
    } while (pageToken);
  
    out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    console.log(`[HR] readHeartRateSeries(): total samples=${out.length}`);
    return out;
  }
  
  /**
   * Heuristic: return ONLY the samples from the most recently modified batch.
   * We approximate a "chunk" by the newest metadata.lastModifiedTime across the window,
   * and include all records that share that same lastModified (to the same second).
   */
  export async function readLatestChunk(
    minutesBack = 180
  ): Promise<{ bpm: number; at: string }[]> {
    console.log("[HR] readLatestChunk(): scanning for newest batch…");
    // 1) Pull a broader window so the newest batch is included
    const end = new Date();
    const start = new Date(end.getTime() - minutesBack * 60 * 1000);
  
    let pageToken: string | undefined;
    let newestLM: string | undefined; // newest lastModifiedTime
    const bucket: Array<{ lm: string; rec: any }> = [];
  
    do {
      const res: any = await readRecords("HeartRate", {
        timeRangeFilter: {
          operator: "between",
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        },
        pageSize: 1000,
        pageToken,
      });
      pageToken = res?.nextPageToken;
      const records = res?.records ?? [];
  
      for (const rec of records) {
        const lm = (rec as any)?.metadata?.lastModifiedTime;
        if (lm) {
          bucket.push({ lm, rec });
          if (!newestLM || new Date(lm).getTime() > new Date(newestLM).getTime()) {
            newestLM = lm;
          }
        }
      }
    } while (pageToken);
  
    if (!newestLM) {
      console.log("[HR] readLatestChunk(): no lastModifiedTime found → returning []");
      return [];
    }
  
    // 2) Keep records whose lastModifiedTime matches newestLM to the same second
    const newestKey = new Date(newestLM).toISOString().slice(0, 19); // up to seconds
    const chosen = bucket
      .filter(({ lm }) => new Date(lm).toISOString().slice(0, 19) === newestKey)
      .map((x) => x.rec);
  
    console.log(
      `[HR] readLatestChunk(): newest batch LM=${newestLM} → matched records=${chosen.length}`
    );
  
    const samples: { bpm: number; at: string }[] = [];
    for (const rec of chosen) {
      const r: any = rec;
      if (Array.isArray(r.samples) && r.samples.length) {
        for (const s of r.samples) {
          samples.push({ bpm: s.beatsPerMinute, at: s.time });
        }
      } else {
        const bpm =
          typeof r.beatsPerMinute === "number" ? r.beatsPerMinute : r.bpm;
        const at = r.endTime ?? r.startTime;
        if (typeof bpm === "number" && at) samples.push({ bpm, at });
      }
    }
  
    samples.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()); // oldest→newest within batch
    console.log(
      `[HR] readLatestChunk(): samples in newest batch=${samples.length} (range ${samples[0]?.at ?? "∅"} → ${samples.at(-1)?.at ?? "∅"})`
    );
    return samples;
  }

  /**
   * Aggressive heart rate detection - tries multiple strategies to find recent HR data
   */
  export async function findRecentHeartRate(): Promise<{ bpm: number | null; at?: string; source: string }> {
    console.log("[HR] Starting aggressive heart rate detection...");
    
    // Strategy 1: Look for very recent data (last 10 minutes)
    try {
      const recent = await readLatestBpm(10);
      if (recent.bpm) {
        console.log("[HR] Found recent data (10min window)");
        return { ...recent, source: "recent" };
      }
    } catch (e) {
      console.log("[HR] Recent window failed:", e);
    }

    // Strategy 2: Look for data in last hour
    try {
      const hourly = await readLatestBpm(60);
      if (hourly.bpm) {
        console.log("[HR] Found hourly data");
        return { ...hourly, source: "hourly" };
      }
    } catch (e) {
      console.log("[HR] Hourly window failed:", e);
    }

    // Strategy 3: Look for data in last 3 hours
    try {
      const extended = await readLatestBpm(180);
      if (extended.bpm) {
        console.log("[HR] Found extended data (3hr window)");
        return { ...extended, source: "extended" };
      }
    } catch (e) {
      console.log("[HR] Extended window failed:", e);
    }

    // Strategy 4: Try to get the latest chunk (most recent batch)
    try {
      const chunk = await readLatestChunk(180);
      if (chunk.length > 0) {
        const latest = chunk[chunk.length - 1]; // Most recent in chunk
        console.log("[HR] Found data from latest chunk");
        return { bpm: latest.bpm, at: latest.at, source: "chunk" };
      }
    } catch (e) {
      console.log("[HR] Chunk strategy failed:", e);
    }

    console.log("[HR] No heart rate data found with any strategy");
    return { bpm: null, at: undefined, source: "none" };
  }

  /**
   * Force a heart rate measurement by opening Samsung Health
   */
  export async function triggerHeartRateMeasurement(): Promise<void> {
    try {
      console.log("[HR] Attempting to trigger heart rate measurement...");
      
      // This would ideally open Samsung Health to the heart rate measurement screen
      // For now, we'll just log the attempt
      console.log("[HR] Please manually measure your heart rate on your Galaxy Watch");
      console.log("[HR] The measurement should appear in Health Connect within a few minutes");
      
      // You could potentially use deep linking to open Samsung Health:
      // Linking.openURL('samsunghealth://heartrate');
      
    } catch (error) {
      console.error("[HR] Failed to trigger measurement:", error);
    }
  }
  