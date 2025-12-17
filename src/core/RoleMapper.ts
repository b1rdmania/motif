import type { NoteEvent, StructuralFeatures, RoleAssignment, Role } from '../types';

export class RoleMapper {
  assignRoles(features: StructuralFeatures, events: NoteEvent[]): RoleAssignment[] {
    const assignments: RoleAssignment[] = [];
    const trackEvents = this.groupEventsByTrack(events);

    for (const [trackId, trackNotes] of trackEvents) {
      const role = this.determineRole(trackNotes, features);
      const confidence = this.calculateConfidence(trackNotes, role);
      
      assignments.push({
        role,
        sourceTrack: trackId,
        events: trackNotes,
        confidence
      });
    }

    return assignments;
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

  private determineRole(events: NoteEvent[], features: StructuralFeatures): Role {
    if (events.length === 0) return 'texture';

    const avgPitch = events.reduce((sum, e) => sum + e.pitch, 0) / events.length;
    const avgDuration = events.reduce((sum, e) => sum + e.duration, 0) / events.length;
    const avgVelocity = events.reduce((sum, e) => sum + e.velocity, 0) / events.length;

    // Bass: low register, rhythmic
    if (avgPitch < 48 && avgDuration < 1.0) {
      return 'bass';
    }

    // Drone: sustained notes
    if (avgDuration > 2.0) {
      return 'drone';
    }

    // Ostinato: repetitive short notes
    if (avgDuration < 0.5 && events.length > 10) {
      return 'ostinato';
    }

    // Accents: high velocity peaks
    if (avgVelocity > 0.8) {
      return 'accents';
    }

    return 'texture';
  }

  private calculateConfidence(events: NoteEvent[], role: Role): number {
    // Simple confidence calculation based on how well events fit the role
    // In a real implementation, this would be more sophisticated
    return 0.7 + Math.random() * 0.3;
  }
}