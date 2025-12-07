# Enabling Continuous Heart Rate Monitoring

## Problem
You're only getting data when manually measuring on the watch. You need automatic measurements every 10 minutes.

## Solution: Enable Continuous Monitoring

### Step 1: Galaxy Watch Settings

**On your Galaxy Watch:**

1. **Open Samsung Health app** on the watch
2. **Tap the Settings icon** (gear/cog icon)
3. **Tap "Heart rate"**
4. **Find and enable these settings:**
   - **"Continuous measurement"** → Toggle ON
   - **"Measure frequently"** → Select "Frequent" or "Every 10 minutes"
   - **"Measure during sleep"** → Toggle ON (optional but recommended)

5. **Confirm the settings are saved**

**Alternative location (some watch models):**
- Watch Settings → Health → Heart rate → Continuous measurement

### Step 2: Samsung Health Phone App Settings

**On your phone:**

1. **Open Samsung Health app**
2. **Tap "Me" or Profile** (bottom right)
3. **Tap Settings** (gear icon)
4. **Tap "Heart rate"**
5. **Verify these are ON:**
   - "Measure continuously"
   - "Measure during exercise"
   - "Measure during sleep" (optional)

### Step 3: Verify Sync

**Check Health Connect sync:**

1. Samsung Health → Settings → Connected services
2. **Health Connect** → Make sure it's enabled
3. Check "Last synced" time

**Force a sync:**
- Open Samsung Health app on phone
- Pull down to refresh
- This triggers immediate sync to Health Connect

### Step 4: Test in TripTune

**New Diagnostic Feature Added:**

1. Open TripTune
2. Go to **Health tab**
3. Tap **"Check Measurement Frequency"** button

This will:
- Show all measurements from last 3 hours
- Calculate average time between measurements
- Tell you if continuous monitoring is working
- Display the measurement history

**Expected Results:**

If continuous monitoring is working:
- Should see 10-20 measurements in 3 hours
- Average interval: 8-12 minutes
- Message: "Continuous monitoring appears to be working"

If NOT working:
- 0-2 measurements (only manual ones)
- Message: "No automatic measurements"
- Action: Check watch settings again

## Common Issues

### Issue 1: Battery Saving Mode
**Problem**: Watch disabled continuous monitoring to save battery

**Solution**:
- Watch Settings → Battery → Power saving mode → OFF
- Or enable "Always measure heart rate" even in power saving mode

### Issue 2: Not Wearing Watch
**Problem**: Watch thinks it's not on your wrist

**Solution**:
- Ensure watch is snug on wrist
- Clean the sensors on back of watch
- Watch Settings → Display → "Wake on wrist raise" → ON

### Issue 3: Watch Not Syncing
**Problem**: Watch measures but doesn't sync to phone

**Solution**:
- Ensure Bluetooth is connected
- Open Samsung Health on phone to force sync
- Restart both watch and phone if needed

### Issue 4: Old Watch Model
**Problem**: Some older watches don't support continuous monitoring

**Solution**:
- Check your watch model's specifications
- Manual measurements every 10-15 minutes as workaround
- Consider upgrading watch if needed

## Verify It's Working

### Method 1: Check in Samsung Health
1. Open Samsung Health on phone
2. Tap "Heart rate"
3. Look at the graph
4. Should see multiple measurements throughout the day
5. Not just when you manually measured

### Method 2: Check in TripTune
1. Health tab → "Check Measurement Frequency"
2. Should show measurements every 8-12 minutes
3. Check the "Recent Measurements" list

### Method 3: Wait and Observe
1. Don't touch your watch for 30 minutes
2. Check TripTune Health tab
3. Tap "Refresh Now"
4. Should see 2-3 new measurements from the last 30 minutes

## Expected Behavior

**Once properly configured:**

- **Watch measures**: Every 8-12 minutes automatically
- **Syncs to Health Connect**: Within 1-5 minutes of measurement
- **TripTune polls**: Every 5 minutes
- **Result**: Fresh data (< 15 minutes old) most of the time

**Timeline example:**
```
10:00 - Watch measures: 75 BPM
10:02 - Syncs to Health Connect
10:05 - TripTune polls and shows: 75 BPM

10:10 - Watch measures: 78 BPM
10:11 - Syncs to Health Connect
10:15 - TripTune polls and shows: 78 BPM

10:20 - Watch measures: 80 BPM
10:21 - Syncs to Health Connect
10:25 - TripTune polls and shows: 80 BPM
```

## Battery Impact

**Continuous monitoring uses more battery:**
- Normal: 2-3 days battery life → 1-2 days with continuous monitoring
- Worth it for accurate health tracking
- Charge watch nightly

**To balance battery and monitoring:**
- Enable continuous monitoring during the day
- Disable at night if you don't need sleep tracking
- Or use "Normal" frequency instead of "Frequent"

## Still Not Working?

If you've enabled everything and still only see manual measurements:

1. **Restart watch and phone**
2. **Re-pair the watch** (remove and add again in Galaxy Wearable app)
3. **Check for updates**:
   - Galaxy Wearable app
   - Samsung Health app
   - Watch firmware
4. **Contact Samsung Support** - Your watch may have a hardware issue

## Using the New Diagnostic Feature

**In TripTune Health tab:**

**"Check Measurement Frequency" button** will tell you:
- ✓ Working: "Found X measurements, avg 10 minutes"
- ⚠️ Infrequent: "Found X measurements, avg 20+ minutes"  
- ❌ Not working: "No measurements found"

**Recent Measurements list** shows:
- Last 10 measurements
- Time of each measurement
- How long ago
- Helps you verify automatic measurements are happening

---

**Bottom Line**: Enable "Continuous measurement" on your Galaxy Watch, verify with the diagnostic feature, and you'll get automatic heart rate data every 10 minutes!

