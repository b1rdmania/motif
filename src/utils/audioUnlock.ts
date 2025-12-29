/**
 * iOS/Safari audio unlock utility.
 *
 * Older iOS versions require:
 * 1. AudioContext created during a user gesture
 * 2. A silent buffer played to fully "unlock" the audio system
 * 3. Verification that the context is actually running
 *
 * This utility handles all of that in a backward-compatible way.
 */

let sharedAudioContext: AudioContext | null = null;
let unlockPromise: Promise<AudioContext> | null = null;

/**
 * Get or create the shared AudioContext.
 * Call this during a user gesture (click/touch) for best iOS compatibility.
 */
export function getAudioContext(): AudioContext {
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContext();
  }
  return sharedAudioContext;
}

/**
 * Return the existing AudioContext without creating one.
 * Useful for UI/debug without triggering iOS restrictions.
 */
export function peekAudioContext(): AudioContext | null {
  return sharedAudioContext;
}

/**
 * Unlock audio for iOS/Safari. Safe to call multiple times.
 * Returns the AudioContext once it's confirmed running.
 *
 * Must be called from a user gesture (click/touchend).
 */
export async function unlockAudio(): Promise<AudioContext> {
  const ctx = sharedAudioContext;
  if (ctx?.state === 'running') return ctx;

  // IMPORTANT: allow retries. If a previous unlock attempt ran outside a user gesture
  // or failed to transition the context to running, iOS can remain blocked.
  // We only de-dupe concurrent calls; once an attempt finishes, we clear the promise.
  if (unlockPromise) return unlockPromise;

  unlockPromise = doUnlock().finally(() => {
    unlockPromise = null;
  });
  return unlockPromise;
}

async function doUnlock(): Promise<AudioContext> {
  const ctx = getAudioContext();

  // Already running - nothing to do
  if (ctx.state === 'running') {
    return ctx;
  }

  // CRITICAL for iOS: Call resume() synchronously in user gesture context.
  // Don't await - just fire it off immediately to register the user intent.
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  // Play a silent buffer IMMEDIATELY to fully unlock on iOS.
  // This must happen synchronously in the user gesture.
  try {
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    source.stop(0.001);
  } catch (e) {
    // Ignore - this is just a fallback unlock
  }

  // Now try resume again and wait for it
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (e) {
      console.warn('AudioContext.resume() failed:', e);
    }
  }

  // Wait briefly for state to update (cast to string to avoid TS narrowing issues)
  const getState = () => ctx.state as string;

  if (getState() !== 'running') {
    await new Promise<void>((resolve) => {
      const checkState = () => {
        if (getState() === 'running') {
          resolve();
        } else {
          // Try one more resume
          ctx.resume().catch(() => {});
          setTimeout(checkState, 50);
        }
      };
      // Give up after 500ms to avoid blocking forever
      setTimeout(resolve, 500);
      checkState();
    });
  }

  if (getState() !== 'running') {
    console.warn('AudioContext still not running after unlock attempt, state:', ctx.state);
  }

  return ctx;
}

/**
 * Check if audio is currently unlocked and ready.
 */
export function isAudioReady(): boolean {
  return sharedAudioContext?.state === 'running';
}
