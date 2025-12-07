// lib/health.ts
import {
  initialize,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
  getSdkStatus,
  SdkAvailabilityStatus,
} from "react-native-health-connect";
import { Linking, NativeModules, Platform } from "react-native";
  
  let hcReady = false;

  /**
   * Check if Health Connect SDK is available on this device
   */
  export async function checkHealthConnectAvailability(): Promise<{
    available: boolean;
    status: string;
    message: string;
  }> {
    try {
      const status = await getSdkStatus();
      console.log("[HC] SDK Status:", status);
      
      if (status === SdkAvailabilityStatus.SDK_AVAILABLE) {
        return {
          available: true,
          status: "SDK_AVAILABLE",
          message: "Health Connect is available"
        };
      } else if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE) {
        return {
          available: false,
          status: "SDK_UNAVAILABLE",
          message: "Health Connect is not available on this device"
        };
      } else if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
        return {
          available: false,
          status: "UPDATE_REQUIRED",
          message: "Health Connect needs to be updated"
        };
      } else {
        return {
          available: false,
          status: "UNKNOWN",
          message: "Unknown Health Connect status"
        };
      }
    } catch (error: any) {
      console.error("[HC] Failed to check availability:", error);
      return {
        available: false,
        status: "ERROR",
        message: error.message || "Failed to check Health Connect"
      };
    }
  }
  
  /**
   * Initialize Health Connect and request read permission for HeartRate.
   * Lots of logs so it's obvious what's going on.
   */
  export async function ensureHCReady(): Promise<void> {
    if (hcReady) {
      console.log("[HC] Already initialized");
      return;
    }
    
    // Check if Health Connect is available
    console.log("[HC] Checking Health Connect availability...");
    const availability = await checkHealthConnectAvailability();
    console.log("[HC] Availability:", availability);
    
    if (!availability.available) {
      throw new Error(`Health Connect not available: ${availability.message}`);
    }
    
    console.log("[HC] Initializing Health Connect...");
    const isInitialized = await initialize();
    console.log("[HC] Initialize result:", isInitialized);
    
    console.log("[HC] Requesting permission: HeartRate (read) ...");
    const granted = await requestPermission([{ accessType: "read", recordType: "HeartRate" }]);
    console.log("[HC] Permission result:", JSON.stringify(granted));
    
    // requestPermission returns an array of granted permissions
    // If array is empty or doesn't include HeartRate, permission was denied
    if (!Array.isArray(granted) || granted.length === 0) {
      console.error("[HC] Permission DENIED - User needs to grant manually");
      console.error("[HC] INSTRUCTIONS: Go to Settings → Apps → TripTune → Permissions → Enable 'Physical activity'");
      throw new Error(
        "Permission denied. Please grant manually:\n\n" +
        "1. Open Settings on your phone\n" +
        "2. Go to Apps → TripTune\n" +
        "3. Tap Permissions\n" +
        "4. Enable 'Physical activity' or 'Body sensors'\n\n" +
        "Then restart TripTune."
      );
    }
    
    hcReady = true;
    console.log("[HC] Permission GRANTED - Ready");
  }
  
  /**
   * Open Health Connect settings (with error surfaced).
   */
  export async function openHCSettings() {
    try {
      console.log("[HC] Opening Health Connect settings...");
      await openHealthConnectSettings();
    } catch (e) {
      console.log("[HC] Failed to open HC settings:", e);
      throw new Error("Unable to open Health Connect settings");
    }
  }

  /**
   * Open Android app settings for TripTune
   */
  export async function openAppSettings() {
    try {
      console.log("[HC] Opening app settings...");
      await Linking.openSettings();
    } catch (e) {
      console.error("[HC] Failed to open app settings:", e);
    }
  }

  /**
   * Try to read a single heart rate record to test if permission is granted
   */
  export async function testPermission(): Promise<boolean> {
    try {
      console.log("[HC] Testing permission by attempting to read data...");
      const end = new Date();
      const start = new Date(end.getTime() - 60000); // Last 1 minute
      
      await readRecords("HeartRate", {
        timeRangeFilter: {
          operator: "between",
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        },
        pageSize: 1,
      });
      
      console.log("[HC] Permission test PASSED - Can read heart rate");
      return true;
    } catch (error: any) {
      if (error.message && error.message.includes("SecurityException")) {
        console.log("[HC] Permission test FAILED - SecurityException (no permission)");
        return false;
      }
      console.log("[HC] Permission test FAILED - Other error:", error);
      return false;
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
      `[HR] readLatestBpm(): window ${start.toISOString()} -> ${end.toISOString()}`
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
        `[HR] readLatestBpm(): got ${records.length} records; nextPageToken=${pageToken ?? "empty"}`
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
   * Sorted newest to oldest. Loud logging so you see batch arrivals.
   */
  export async function readHeartRateSeries(
    minutesBack = 60
  ): Promise<{ bpm: number; at: string }[]> {
    const end = new Date();
    const start = new Date(end.getTime() - minutesBack * 60 * 1000);
    console.log(
      `[HR] readHeartRateSeries(): window ${start.toISOString()} -> ${end.toISOString()}`
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
        `[HR] readHeartRateSeries(): got ${records.length} records; nextPageToken=${pageToken ?? "empty"}`
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
    console.log("[HR] readLatestChunk(): scanning for newest batch...");
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
      console.log("[HR] readLatestChunk(): no lastModifiedTime found -> returning []");
      return [];
    }
  
    // 2) Keep records whose lastModifiedTime matches newestLM to the same second
    const newestKey = new Date(newestLM).toISOString().slice(0, 19); // up to seconds
    const chosen = bucket
      .filter(({ lm }) => new Date(lm).toISOString().slice(0, 19) === newestKey)
      .map((x) => x.rec);
  
    console.log(
      `[HR] readLatestChunk(): newest batch LM=${newestLM} -> matched records=${chosen.length}`
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
  
    samples.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()); // oldest to newest within batch
    console.log(
      `[HR] readLatestChunk(): samples in newest batch=${samples.length} (range ${samples[0]?.at ?? "empty"} -> ${samples.at(-1)?.at ?? "empty"})`
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
   * Fast version of readLatestBpm - optimized for frequent polling
   * Uses smaller time window and returns immediately
   */
  export async function readLatestBpmFast(
    minutesBack = 180 // Increased to 3 hours to handle Samsung Health sync delays
  ): Promise<{ bpm: number | null; at?: string }> {
    const end = new Date();
    const start = new Date(end.getTime() - minutesBack * 60 * 1000);
  
    console.log(
      `[HR] readLatestBpmFast(): Searching ${minutesBack} minutes back`
    );
    console.log(
      `[HR] readLatestBpmFast(): Window ${start.toLocaleString()} -> ${end.toLocaleString()}`
    );
    console.log(
      `[HR] readLatestBpmFast(): Window ISO ${start.toISOString()} -> ${end.toISOString()}`
    );
  
    let latest: { bpm: number; at: string } | null = null;
  
    try {
      const res: any = await readRecords("HeartRate", {
        timeRangeFilter: {
          operator: "between",
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        },
        pageSize: 200, // Increase to handle more records (3 hours)
        ascending: false, // Get newest first
      });
  
      const records = res?.records ?? [];
      console.log(`[HR] readLatestBpmFast(): got ${records.length} records`);
      
      // Log lastModified times to see when Samsung Health last synced
      if (records.length > 0) {
        console.log(`[HR] Record lastModified times (most recent first):`);
        records.slice(0, 5).forEach((r: any, idx: number) => {
          const modified = r.metadata?.lastModifiedTime || r.lastModifiedTime;
          if (modified) {
            const modTime = new Date(modified);
            const ageMin = Math.floor((Date.now() - modTime.getTime()) / (1000 * 60));
            console.log(`  [${idx + 1}] Last synced: ${modTime.toLocaleTimeString()} (${ageMin}m ago) - ${r.samples?.length || 0} samples`);
          }
        });
      }
  
      // Collect all samples
      const allSamples: { bpm: number; at: string }[] = [];
  
      for (const rec of records) {
        const r: any = rec;
        if (Array.isArray(r.samples) && r.samples.length) {
          for (const s of r.samples) {
            allSamples.push({ bpm: s.beatsPerMinute, at: s.time });
          }
        } else {
          const bpm =
            typeof r.beatsPerMinute === "number" ? r.beatsPerMinute : r.bpm;
          const at = r.endTime ?? r.startTime;
          if (typeof bpm === "number" && at) {
            allSamples.push({ bpm, at });
          }
        }
      }

      // Sort by timestamp descending (newest first)
      allSamples.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      
      // Get the absolute latest
      if (allSamples.length > 0) {
        latest = allSamples[0];
        console.log(`[HR] readLatestBpmFast(): Latest is ${latest.bpm} BPM at ${new Date(latest.at).toLocaleTimeString()}`);
      } else {
        console.log(`[HR] readLatestBpmFast(): No samples found`);
      }
    } catch (error) {
      console.error("[HR] readLatestBpmFast() error:", error);
    }
  
    return { bpm: latest?.bpm ?? null, at: latest?.at };
  }

  /**
   * Comprehensive health check - tests all aspects of Health Connect integration
   */
  export async function runHealthConnectDiagnostics(): Promise<{
    initialized: boolean;
    permissionGranted: boolean;
    dataAvailable: boolean;
    latestData: { bpm: number | null; at?: string; source: string };
    errors: string[];
  }> {
    const errors: string[] = [];
    let initialized = false;
    let permissionGranted = false;
    let dataAvailable = false;
    let latestData = { bpm: null, at: undefined, source: "none" };

    try {
      console.log("[DIAG] Starting Health Connect diagnostics...");
      
      // Test 1: Initialization
      try {
        await ensureHCReady();
        initialized = true;
        permissionGranted = true;
        console.log("[DIAG] ✅ Health Connect initialized and permissions granted");
      } catch (e: any) {
        errors.push(`Initialization failed: ${e.message}`);
        console.error("[DIAG] ❌ Initialization failed:", e);
        return { initialized, permissionGranted, dataAvailable, latestData, errors };
      }

      // Test 2: Data availability
      try {
        const result = await findRecentHeartRate();
        latestData = result;
        if (result.bpm !== null) {
          dataAvailable = true;
          console.log("[DIAG] ✅ Heart rate data found:", result);
        } else {
          errors.push("No heart rate data available in Health Connect");
          console.log("[DIAG] ⚠️ No heart rate data found");
        }
      } catch (e: any) {
        errors.push(`Data read failed: ${e.message}`);
        console.error("[DIAG] ❌ Data read failed:", e);
      }

      console.log("[DIAG] Diagnostics complete");
      return { initialized, permissionGranted, dataAvailable, latestData, errors };
    } catch (e: any) {
      errors.push(`Unexpected error: ${e.message}`);
      return { initialized, permissionGranted, dataAvailable, latestData, errors };
    }
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

  /**
   * Trigger Samsung Health to sync with Health Connect
   * Opens Health Connect settings to force a cache refresh
   */
  export async function triggerSamsungHealthSync(): Promise<boolean> {
    try {
      console.log("[HR] Triggering Health Connect data refresh...");
      
      // Opening Health Connect settings forces it to check for new data
      await openHealthConnectSettings();
      console.log("[HR] Health Connect settings opened - this forces a data refresh");
      console.log("[HR] User should check permissions and return to app");
      
      return true;
    } catch (error: any) {
      console.error("[HR] Failed to trigger sync:", error);
      return false;
    }
  }

  /**
   * Force a fresh read by doing multiple queries to bust Health Connect cache
   */
  export async function forceFreshRead(): Promise<{ bpm: number | null; at?: string }> {
    console.log("[HR] Forcing fresh read with cache busting...");
    
    // Try multiple read attempts with slightly different windows
    const attempts = [
      { minutesBack: 180, label: "3 hours" },
      { minutesBack: 1440, label: "24 hours" }, // Much wider window
      { minutesBack: 360, label: "6 hours" },
    ];
    
    let bestResult: { bpm: number | null; at?: string } = { bpm: null };
    
    for (const attempt of attempts) {
      console.log(`[HR] Cache bust attempt: ${attempt.label} window`);
      const result = await readLatestBpmFast(attempt.minutesBack);
      
      // Keep the newest result
      if (result.bpm !== null && result.at) {
        if (!bestResult.at || new Date(result.at) > new Date(bestResult.at)) {
          bestResult = result;
        }
      }
      
      // Small delay between attempts
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    if (bestResult.bpm) {
      console.log(`[HR] Cache bust successful: ${bestResult.bpm} BPM at ${new Date(bestResult.at!).toLocaleTimeString()}`);
    } else {
      console.log("[HR] Cache bust found no data");
    }
    
    return bestResult;
  }
  