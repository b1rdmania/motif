import type { NoteEvent, ChordEvent, StructuralFeatures, RoleAssignment, Role, TrackFeatures } from '../types';

export class RoleMapper {
  assignRoles(features: StructuralFeatures, events: NoteEvent[]): RoleAssignment[] {
    const assignments: RoleAssignment[] = [];
    const trackEvents = this.groupEventsByTrack(events);
    const roleScores = new Map<number, Map<Role, number>>();

    // Calculate features and scores for each track
    for (const [trackId, trackNotes] of trackEvents) {
      const trackFeatures = this.extractTrackFeatures(trackNotes);
      const scores = this.calculateRoleScores(trackFeatures, features);
      
      features.trackFeatures.set(trackId, trackFeatures);
      roleScores.set(trackId, scores);
    }

    // Assign roles using competitive allocation
    const assignedRoles = this.allocateRoles(roleScores, trackEvents);

    // Create assignments with chord extraction
    for (const [trackId, role] of assignedRoles) {
      const trackNotes = trackEvents.get(trackId)!;
      const trackFeatures = features.trackFeatures.get(trackId)!;
      const chords = this.extractChords(trackNotes);
      const confidence = roleScores.get(trackId)!.get(role)!;

      assignments.push({
        role,
        sourceTrack: trackId,
        events: trackNotes,
        chords,
        confidence,
        features: trackFeatures
      });
    }

    console.log('Role assignments:', Array.from(assignedRoles.entries()));
    return assignments;
  }

  private extractTrackFeatures(events: NoteEvent[]): TrackFeatures {
    if (events.length === 0) {
      return this.getDefaultTrackFeatures();
    }

    const pitches = events.map(e => e.pitch).sort((a, b) => a - b);
    const medianPitch = pitches[Math.floor(pitches.length / 2)];
    const pitchRange = Math.max(...pitches) - Math.min(...pitches);
    
    const duration = Math.max(...events.map(e => e.time + e.duration)) - Math.min(...events.map(e => e.time));
    const noteDensity = events.length / Math.max(duration, 1);
    
    const polyphonyRatio = this.calculatePolyphony(events);
    const averageDuration = events.reduce((sum, e) => sum + e.duration, 0) / events.length;
    const repetitionScore = this.calculateRepetition(events);
    
    const isMonophonic = polyphonyRatio < 0.1;
    const hasPhraseContinuity = this.detectPhraseContinuity(events);
    
    let register: 'low' | 'mid' | 'high';
    if (medianPitch < 48) register = 'low';
    else if (medianPitch < 72) register = 'mid';
    else register = 'high';

    return {
      medianPitch,
      pitchRange,
      noteDensity,
      polyphonyRatio,
      averageDuration,
      repetitionScore,
      isMonophonic,
      hasPhraseContinuity,
      register
    };
  }

  private calculateRoleScores(features: TrackFeatures, _globalFeatures: StructuralFeatures): Map<Role, number> {
    const scores = new Map<Role, number>();

    // Bass scoring
    let bassScore = 0;
    if (features.register === 'low') bassScore += 0.6;
    if (features.isMonophonic) bassScore += 0.2;
    if (features.averageDuration < 1.0) bassScore += 0.2;
    if (features.repetitionScore > 0.3) bassScore += 0.1;
    scores.set('bass', Math.min(bassScore, 1.0));

    // Melody scoring (highest priority for monophonic mid/high register with continuity)
    let melodyScore = 0;
    if (features.isMonophonic) melodyScore += 0.4;
    if (features.hasPhraseContinuity) melodyScore += 0.3;
    if (features.register === 'mid' || features.register === 'high') melodyScore += 0.2;
    if (features.pitchRange > 12) melodyScore += 0.1; // Wide range suggests melody
    scores.set('melody', Math.min(melodyScore, 1.0));

    // Drone scoring
    let droneScore = 0;
    if (features.averageDuration > 2.0) droneScore += 0.5;
    if (features.polyphonyRatio > 0.3) droneScore += 0.2; // Chords work for drone
    if (features.noteDensity < 2.0) droneScore += 0.2; // Sparse notes
    if (features.repetitionScore < 0.2) droneScore += 0.1; // Not too repetitive
    scores.set('drone', Math.min(droneScore, 1.0));

    // Ostinato scoring
    let ostinatoScore = 0;
    if (features.repetitionScore > 0.5) ostinatoScore += 0.4;
    if (features.averageDuration < 0.8) ostinatoScore += 0.2;
    if (features.noteDensity > 3.0) ostinatoScore += 0.2;
    if (features.pitchRange < 12) ostinatoScore += 0.1; // Limited range
    scores.set('ostinato', Math.min(ostinatoScore, 1.0));

    // Texture scoring (catch-all for polyphonic accompaniment)
    let textureScore = 0;
    if (features.polyphonyRatio > 0.2) textureScore += 0.3;
    if (features.register === 'mid') textureScore += 0.2;
    if (features.noteDensity > 1.0 && features.noteDensity < 4.0) textureScore += 0.2;
    if (features.averageDuration > 0.5 && features.averageDuration < 3.0) textureScore += 0.1;
    if (features.repetitionScore < 0.4) textureScore += 0.1;
    scores.set('texture', Math.min(textureScore, 1.0));

    // Accents scoring (high velocity, sparse, punchy)
    let accentsScore = 0;
    if (features.noteDensity < 1.0) accentsScore += 0.3; // Sparse
    if (features.averageDuration < 0.5) accentsScore += 0.3; // Short
    if (features.register === 'high') accentsScore += 0.2;
    scores.set('accents', Math.min(accentsScore, 1.0));

    return scores;
  }

  private allocateRoles(roleScores: Map<number, Map<Role, number>>, _trackEvents: Map<number, NoteEvent[]>): Map<number, Role> {
    const assignments = new Map<number, Role>();
    const assignedRoles = new Set<Role>();

    // Sort tracks by their best role scores
    const trackRolePrefs = Array.from(roleScores.entries()).map(([trackId, scores]) => {
      const bestRole = Array.from(scores.entries()).reduce((a, b) => a[1] > b[1] ? a : b);
      return { trackId, role: bestRole[0], score: bestRole[1] };
    }).sort((a, b) => b.score - a.score);

    // Assign roles greedily, but allow some duplication
    for (const { trackId, role, score } of trackRolePrefs) {
      if (score < 0.3) continue; // Skip low-confidence assignments
      
      // Allow multiple texture/ostinato tracks, but prefer unique roles for others
      if (!assignedRoles.has(role) || role === 'texture' || role === 'ostinato') {
        assignments.set(trackId, role);
        assignedRoles.add(role);
      } else {
        // Find next best role for this track
        const scores = roleScores.get(trackId)!;
        const alternatives = Array.from(scores.entries())
          .filter(([r]) => !assignedRoles.has(r) || r === 'texture')
          .sort((a, b) => b[1] - a[1]);
        
        if (alternatives.length > 0 && alternatives[0][1] > 0.2) {
          assignments.set(trackId, alternatives[0][0]);
          assignedRoles.add(alternatives[0][0]);
        } else {
          // Fallback to texture
          assignments.set(trackId, 'texture');
        }
      }
    }

    return assignments;
  }

  private extractChords(events: NoteEvent[]): ChordEvent[] {
    const chords: ChordEvent[] = [];
    const timeGrouping = 0.05; // 50ms window for simultaneous notes
    
    // Group events by time
    const timeGroups = new Map<number, NoteEvent[]>();
    for (const event of events) {
      const timeKey = Math.round(event.time / timeGrouping) * timeGrouping;
      if (!timeGroups.has(timeKey)) {
        timeGroups.set(timeKey, []);
      }
      timeGroups.get(timeKey)!.push(event);
    }

    // Convert groups with multiple notes to chords
    for (const [time, groupEvents] of timeGroups) {
      if (groupEvents.length > 1) {
        // Sort by pitch and create chord
        groupEvents.sort((a, b) => a.pitch - b.pitch);
        const avgDuration = groupEvents.reduce((sum, e) => sum + e.duration, 0) / groupEvents.length;
        const avgVelocity = groupEvents.reduce((sum, e) => sum + e.velocity, 0) / groupEvents.length;
        
        chords.push({
          time,
          duration: avgDuration,
          pitches: groupEvents.map(e => e.pitch),
          velocity: avgVelocity,
          track: groupEvents[0].track
        });
      }
    }

    return chords.sort((a, b) => a.time - b.time);
  }

  private calculatePolyphony(events: NoteEvent[]): number {
    let simultaneousCount = 0;
    let totalChecks = 0;
    
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      let concurrent = 0;
      
      for (let j = 0; j < events.length; j++) {
        if (i === j) continue;
        const other = events[j];
        
        // Check if notes overlap in time
        if (other.time < event.time + event.duration && other.time + other.duration > event.time) {
          concurrent++;
        }
      }
      
      simultaneousCount += concurrent;
      totalChecks++;
    }
    
    return totalChecks > 0 ? simultaneousCount / totalChecks : 0;
  }

  private calculateRepetition(events: NoteEvent[]): number {
    if (events.length < 4) return 0;
    
    // Simple repetition detection: look for repeated pitch patterns
    let repetitions = 0;
    const windowSize = 4;
    
    for (let i = 0; i <= events.length - windowSize * 2; i++) {
      const pattern1 = events.slice(i, i + windowSize).map(e => e.pitch);
      for (let j = i + windowSize; j <= events.length - windowSize; j++) {
        const pattern2 = events.slice(j, j + windowSize).map(e => e.pitch);
        if (this.arraysEqual(pattern1, pattern2)) {
          repetitions++;
          break;
        }
      }
    }
    
    return repetitions / Math.max(events.length - windowSize, 1);
  }

  private detectPhraseContinuity(events: NoteEvent[]): boolean {
    if (events.length < 8) return false;
    
    // Look for melodic motion (stepwise or small interval movement)
    let stepwiseMotion = 0;
    for (let i = 1; i < events.length; i++) {
      const interval = Math.abs(events[i].pitch - events[i-1].pitch);
      if (interval >= 1 && interval <= 4) { // Steps and small leaps
        stepwiseMotion++;
      }
    }
    
    return stepwiseMotion / (events.length - 1) > 0.4;
  }

  private arraysEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  private groupEventsByTrack(events: NoteEvent[]): Map<number, NoteEvent[]> {
    const tracks = new Map<number, NoteEvent[]>();
    
    for (const event of events) {
      if (!tracks.has(event.track)) {
        tracks.set(event.track, []);
      }
      tracks.get(event.track)!.push(event);
    }
    
    return tracks;
  }

  private getDefaultTrackFeatures(): TrackFeatures {
    return {
      medianPitch: 60,
      pitchRange: 12,
      noteDensity: 2.0,
      polyphonyRatio: 0,
      averageDuration: 0.5,
      repetitionScore: 0.2,
      isMonophonic: true,
      hasPhraseContinuity: false,
      register: 'mid'
    };
  }
}