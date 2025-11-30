/**
 * SynthEngine - Web Audio API implementation for a major-7th chord drone
 * with a low-pass filter controlled by hand height and waveform controlled by hand spread.
 */

export class SynthEngine {
  private audioContext: AudioContext | null = null;
  private oscillators: OscillatorNode[] = [];
  private filter: BiquadFilterNode | null = null;
  private gainNode: GainNode | null = null;
  private isPlaying: boolean = false;

  // LFO nodes
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private lfoOffset: ConstantSourceNode | null = null;

  // Analyser for visualization
  private analyser: AnalyserNode | null = null;

  // Chord parameters
  private rootMidi: number = 48; // C4 = MIDI note 48 (default: C minor 7)
  private chordExtension: 7 | 9 = 7; // Chord extension: 7th or 9th
  private chordQuality: 'minor' | 'major' = 'minor'; // Minor or major quality
  
  // Filter parameters
  private maxCutoff: number = 1000; // Max cutoff frequency (controlled by right hand Y)
  private minCutoff: number = 300; // Min cutoff frequency (fixed)
  private currentLfoRate: number = 0.2; // LFO rate in Hz (controlled by right hand X)
  private lfoDepth: number = 1.0; // LFO depth (100% of range - full modulation from min to max)
  private currentWaveformMorph: number = 0; // 0 = sawtooth, 1 = triangle, will be controlled by hand spread
  private lfoStartTime: number = 0; // Track when LFO started for phase calculation
  
  // Volume parameters
  private targetVolume: number = 0.3; // Target volume level (30%)
  private fadeDuration: number = 3.0; // Fade duration in seconds
  
  // LFO freeze state
  private isLfoFrozen: boolean = false;

  /**
   * Initialize the audio context (must be called after user gesture)
   */
  async initialize(): Promise<void> {
    if (this.audioContext) {
      return; // Already initialized
    }

    this.audioContext = new AudioContext();
    
    // Create filter
    this.filter = this.audioContext.createBiquadFilter();
    this.filter.type = 'lowpass';
    // Initial frequency will be set by LFO offset
    this.filter.Q.value = 1; // Resonance

    // Create LFO (Low-Frequency Oscillator) for filter modulation
    this.lfo = this.audioContext.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = this.currentLfoRate;

    // Create LFO gain for depth control
    this.lfoGain = this.audioContext.createGain();
    this.updateLfoDepth();

    // Create constant source for base cutoff (center point)
    this.lfoOffset = this.audioContext.createConstantSource();
    this.updateLfoOffset();

    // Connect LFO modulation: lfo -> lfoGain -> filter.frequency
    // The LFO oscillates between -depth and +depth, adding to the base cutoff
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.filter.frequency);

    // Connect base cutoff: lfoOffset -> filter.frequency (adds to LFO modulation)
    // This sets the center point that the LFO oscillates around
    this.lfoOffset.connect(this.filter.frequency);

    // Start LFO and offset (they run continuously, even when not playing)
    this.lfo.start();
    this.lfoOffset.start();
    this.lfoStartTime = this.audioContext.currentTime;
    
    // Ensure filter frequency is set correctly initially
    const initialFreq = (this.minCutoff + this.maxCutoff) / 2;
    this.filter.frequency.value = initialFreq;

    // Create gain node for master volume
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 0.3; // Start at 30% volume to avoid clipping

    // Create analyser for visualization
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048; // Higher resolution for smoother visualization
    this.analyser.smoothingTimeConstant = 0.8; // Smooth the visualization

    // Connect filter -> gain -> analyser -> destination
    this.filter.connect(this.gainNode);
    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);
  }

  /**
   * Update LFO depth based on current min/max cutoff range
   */
  private updateLfoDepth(): void {
    if (!this.lfoGain || !this.audioContext) {
      return;
    }

    // LFO depth: how much the LFO modulates
    // The LFO oscillates between -1 and +1, so we multiply by half the range
    // to get oscillation between -range/2 and +range/2 around the center
    const range = this.maxCutoff - this.minCutoff;
    // Depth controls how much of the range is modulated (0.8 = 80% of range)
    const depth = (range * this.lfoDepth) / 2; // Divide by 2 since LFO goes -1 to +1
    
    const now = this.audioContext.currentTime;
    this.lfoGain.gain.linearRampToValueAtTime(depth, now + 0.1);
  }

  /**
   * Update LFO offset (base cutoff - center point)
   */
  private updateLfoOffset(): void {
    if (!this.lfoOffset || !this.audioContext) {
      return;
    }

    // Base cutoff is the center point between min and max
    // The LFO oscillates around this point
    const baseCutoff = (this.minCutoff + this.maxCutoff) / 2;
    const now = this.audioContext.currentTime;
    this.lfoOffset.offset.linearRampToValueAtTime(baseCutoff, now + 0.1);
  }

  /**
   * Start playing the major-7th chord drone
   */
  start(): void {
    if (!this.audioContext || !this.filter || !this.gainNode) {
      throw new Error('SynthEngine not initialized. Call initialize() first.');
    }

    if (this.isPlaying) {
      return; // Already playing
    }

    // Set volume to 0 initially so we can fade in smoothly
    if (this.gainNode) {
      const now = this.audioContext.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(0, now);
    }

    // Create oscillators for the chord with custom periodic wave
    if (!this.filter) {
      throw new Error('Filter not initialized');
    }
    
    const frequencies = this.getChordFrequencies();
    this.oscillators = frequencies.map((freq) => {
      const oscillator = this.audioContext!.createOscillator();
      oscillator.frequency.value = freq;
      
      // Set waveform to sawtooth (fixed)
      oscillator.type = 'sawtooth';
      
      // Connect each oscillator to the filter
      oscillator.connect(this.filter!);
      
      return oscillator;
    });

    // Start all oscillators
    this.oscillators.forEach((osc) => osc.start());
    this.isPlaying = true;
  }

  /**
   * Calculate frequencies for the current chord (rootMidi + chordExtension + chordQuality)
   * @returns Array of frequencies in Hz (2 for 5th, 4 for 7th, 5 for 9th)
   */
  private getChordFrequencies(): number[] {
    // Chord intervals in semitones from root
    let intervals: number[] = [];
    
    if (this.chordExtension === 7) {
      // 7th chord
      if (this.chordQuality === 'minor') {
        intervals = [0, 3, 7, 10]; // Root, minor 3rd, 5th, minor 7th
      } else {
        intervals = [0, 4, 7, 11]; // Root, major 3rd, 5th, major 7th
      }
    } else if (this.chordExtension === 9) {
      // 9th chord
      if (this.chordQuality === 'minor') {
        intervals = [0, 3, 7, 10, 14]; // Root, minor 3rd, 5th, minor 7th, 9th
      } else {
        intervals = [0, 4, 7, 11, 14]; // Root, major 3rd, 5th, major 7th, 9th
      }
    }
    
    // Convert MIDI notes to frequencies
    // Formula: frequency = 440 * 2^((midiNote - 69) / 12)
    return intervals.map(interval => {
      const midiNote = this.rootMidi + interval;
      return 440 * Math.pow(2, (midiNote - 69) / 12);
    });
  }


  /**
   * Set the chord root, extension, and quality, updating oscillators smoothly
   * @param rootMidi MIDI note number (36-84)
   * @param extension 5, 7, or 9
   * @param quality 'minor' or 'major'
   */
  setChord(rootMidi: number, extension: 7 | 9, quality: 'minor' | 'major'): void {
    // Clamp rootMidi to reasonable range (C2 to C6)
    const clampedRoot = Math.max(36, Math.min(84, rootMidi));
    
    const chordChanged = 
      this.rootMidi !== clampedRoot || 
      this.chordExtension !== extension || 
      this.chordQuality !== quality;
    
    if (!chordChanged) {
      return; // No change needed
    }

    const oldExtension = this.chordExtension;
    const oldOscillatorCount = this.getOscillatorCount(oldExtension);
    
    this.rootMidi = clampedRoot;
    this.chordExtension = extension;
    this.chordQuality = quality;

    const newOscillatorCount = this.getOscillatorCount(extension);
    
    // If oscillator count changed, we need to recreate oscillators
    if (this.isPlaying && oldOscillatorCount !== newOscillatorCount) {
      // Stop old oscillators
      this.oscillators.forEach((osc) => {
        try {
          osc.stop();
        } catch (e) {
          // Oscillator might already be stopped
        }
      });
      
      // Create new oscillators with correct count
      const frequencies = this.getChordFrequencies();
      this.oscillators = frequencies.map((freq) => {
        const oscillator = this.audioContext!.createOscillator();
        oscillator.frequency.value = freq;
        oscillator.type = 'sawtooth';
        oscillator.connect(this.filter!);
        // Apply current waveform morph to new oscillators
        this.applyWaveform(oscillator, this.currentWaveformMorph);
        oscillator.start();
        return oscillator;
      });
    } else if (this.isPlaying && this.oscillators.length === newOscillatorCount) {
      // Same count, just update frequencies
      const newFrequencies = this.getChordFrequencies();
      const now = this.audioContext?.currentTime || 0;
      
      // Smoothly transition frequencies to avoid clicks
      this.oscillators.forEach((osc, index) => {
        if (index < newFrequencies.length) {
          osc.frequency.linearRampToValueAtTime(newFrequencies[index], now + 0.05);
        }
      });
    }
  }

  /**
   * Get the number of oscillators needed for a chord extension
   */
  private getOscillatorCount(extension: 5 | 7 | 9): number {
    if (extension === 5) return 2;
    if (extension === 7) return 4;
    if (extension === 9) return 5;
    return 4; // Default to 7th
  }

  /**
   * Get current root MIDI note
   */
  getRootMidi(): number {
    return this.rootMidi;
  }

  /**
   * Get current chord extension
   */
  getChordExtension(): 5 | 7 | 9 {
    return this.chordExtension;
  }

  /**
   * Get current chord quality
   */
  getChordQuality(): 'minor' | 'major' {
    return this.chordQuality;
  }

  /**
   * Set chord extension (5, 7, or 9)
   */
  setChordExtension(extension: 7 | 9): void {
    if (this.chordExtension === extension) {
      return;
    }
    this.setChord(this.rootMidi, extension, this.chordQuality);
  }

  /**
   * Set chord quality (minor or major)
   */
  setChordQuality(quality: 'minor' | 'major'): void {
    if (this.chordQuality === quality) {
      return;
    }
    this.setChord(this.rootMidi, this.chordExtension, quality);
  }

  /**
   * Stop playing the chord
   */
  stop(): void {
    if (!this.isPlaying) {
      return;
    }

    // Stop all oscillators
    this.oscillators.forEach((osc) => {
      try {
        osc.stop();
      } catch (e) {
        // Oscillator might already be stopped
      }
    });

    this.oscillators = [];
    this.isPlaying = false;
  }

  /**
   * Fade out the volume smoothly (keeps oscillators running)
   */
  fadeOut(duration?: number): void {
    if (!this.gainNode || !this.audioContext || !this.filter) {
      return;
    }

    const fadeTime = duration ?? this.fadeDuration;
    const now = this.audioContext.currentTime;
    
    // Freeze LFO at current filter frequency value
    if (!this.isLfoFrozen && this.lfoGain && this.lfoOffset) {
      // Calculate the current actual filter frequency (including LFO modulation)
      const currentFreq = this.getActualFilterFrequency(now);
      
      // Fade LFO gain to 0 (removes LFO modulation)
      this.lfoGain.gain.cancelScheduledValues(now);
      this.lfoGain.gain.setValueAtTime(this.lfoGain.gain.value, now);
      this.lfoGain.gain.linearRampToValueAtTime(0, now + fadeTime);
      
      // Adjust the offset to maintain the current filter frequency
      // When LFO gain reaches 0, the filter frequency will be just the offset
      // So we set the offset to the current frequency value to freeze it there
      this.lfoOffset.offset.cancelScheduledValues(now);
      this.lfoOffset.offset.setValueAtTime(this.lfoOffset.offset.value, now);
      this.lfoOffset.offset.linearRampToValueAtTime(currentFreq, now + fadeTime);
      
      this.isLfoFrozen = true;
    }
    
    // Fade to zero volume
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.linearRampToValueAtTime(0, now + fadeTime);
  }

  /**
   * Fade in the volume smoothly
   */
  fadeIn(duration?: number): void {
    if (!this.gainNode || !this.audioContext || !this.filter) {
      return;
    }

    const fadeTime = duration ?? this.fadeDuration;
    const now = this.audioContext.currentTime;
    
    // Unfreeze LFO and restore normal modulation
    if (this.isLfoFrozen && this.lfoGain && this.lfoOffset) {
      // Restore LFO offset to center point
      const baseCutoff = (this.minCutoff + this.maxCutoff) / 2;
      this.lfoOffset.offset.cancelScheduledValues(now);
      this.lfoOffset.offset.setValueAtTime(this.lfoOffset.offset.value, now);
      this.lfoOffset.offset.linearRampToValueAtTime(baseCutoff, now + fadeTime);
      
      // Restore LFO gain to full depth with smooth fade
      const range = this.maxCutoff - this.minCutoff;
      const depth = (range * this.lfoDepth) / 2;
      this.lfoGain.gain.cancelScheduledValues(now);
      this.lfoGain.gain.setValueAtTime(this.lfoGain.gain.value, now);
      this.lfoGain.gain.linearRampToValueAtTime(depth, now + fadeTime);
      
      this.isLfoFrozen = false;
    }
    
    // Fade to target volume
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.linearRampToValueAtTime(this.targetVolume, now + fadeTime);
  }

  /**
   * Check if the volume is currently at zero (effectively silent)
   */
  isSilent(): boolean {
    if (!this.gainNode) {
      return true;
    }
    return this.gainNode.gain.value < 0.01;
  }

  /**
   * Set the maximum filter cutoff frequency (controlled by right hand Y position)
   * The LFO will oscillate between minCutoff and this max value
   * @param maxCutoff Maximum frequency in Hz (typically 300-8000)
   */
  setMaxFilterCutoff(maxCutoff: number): void {
    // Clamp to reasonable range
    const clampedMax = Math.max(this.minCutoff + 100, Math.min(20000, maxCutoff));
    this.maxCutoff = clampedMax;

    // Update LFO depth and offset when max changes
    this.updateLfoDepth();
    this.updateLfoOffset();
  }

  /**
   * Set the LFO rate (controlled by right hand X position)
   * @param rate Frequency in Hz (typically 0.1-10)
   */
  setLfoRate(rate: number): void {
    if (!this.lfo) {
      return;
    }

    // Clamp to reasonable range (0.1 Hz to 7 Hz)
    const clampedRate = Math.max(0.1, Math.min(7, rate));
    this.currentLfoRate = clampedRate;

    // Smoothly update LFO rate
    const now = this.audioContext?.currentTime || 0;
    this.lfo.frequency.linearRampToValueAtTime(clampedRate, now + 0.1);
  }

  /**
   * Set the LFO depth (controlled by left hand Y position)
   * @param depth Depth value between 0.0 (minimal modulation) and 1.0 (full modulation)
   */
  setLfoDepth(depth: number): void {
    // Clamp to reasonable range (0.1 = 10% to 1.0 = 100%)
    const clampedDepth = Math.max(0.1, Math.min(1.0, depth));
    this.lfoDepth = clampedDepth;
    // Update the actual LFO gain based on new depth
    this.updateLfoDepth();
  }

  /**
   * Get current max cutoff
   */
  getMaxCutoff(): number {
    return this.maxCutoff;
  }

  /**
   * Get current LFO rate
   */
  getLfoRate(): number {
    return this.currentLfoRate;
  }

  /**
   * Get current LFO depth
   */
  getLfoDepth(): number {
    return this.lfoDepth;
  }

  /**
   * Get current base cutoff (center point)
   */
  getBaseCutoff(): number {
    return (this.minCutoff + this.maxCutoff) / 2;
  }

  /**
   * Get the analyser node for visualization
   */
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /**
   * Get current filter cutoff (for visualization)
   * Returns the base cutoff (center point)
   */
  getCurrentFilterCutoff(): number {
    return this.getBaseCutoff();
  }

  /**
   * Get the actual current filter frequency including LFO modulation
   * @param currentTime Optional audio context time, defaults to current time
   */
  getActualFilterFrequency(currentTime?: number): number {
    if (!this.audioContext) {
      return this.getBaseCutoff();
    }
    
    const time = currentTime ?? this.audioContext.currentTime;
    const elapsed = time - this.lfoStartTime;
    
    // Calculate LFO phase: sin(2π * frequency * time)
    const lfoPhase = Math.sin(2 * Math.PI * this.currentLfoRate * elapsed);
    
    // Calculate the range and depth
    const range = this.maxCutoff - this.minCutoff;
    const depth = (range * this.lfoDepth) / 2; // LFO oscillates ±depth around center
    
    // Base cutoff (center point)
    const baseCutoff = (this.minCutoff + this.maxCutoff) / 2;
    
    // Actual frequency = base + (LFO modulation)
    // LFO oscillates between -depth and +depth, so we add lfoPhase * depth
    return baseCutoff + (lfoPhase * depth);
  }

  /**
   * Get LFO parameters for visualization
   */
  getLfoParams(): { rate: number; depth: number; minCutoff: number; maxCutoff: number } {
    return {
      rate: this.currentLfoRate,
      depth: this.lfoDepth,
      minCutoff: this.minCutoff,
      maxCutoff: this.maxCutoff
    };
  }

  /**
   * Get the current LFO phase in radians [0, 2π]
   * @param currentTime Optional audio context time, defaults to current time
   */
  getLfoPhase(currentTime?: number): number {
    if (!this.audioContext) {
      return 0;
    }
    
    const time = currentTime ?? this.audioContext.currentTime;
    const elapsed = time - this.lfoStartTime;
    
    // Calculate LFO phase: 2π * frequency * time
    const phase = (2 * Math.PI * this.currentLfoRate * elapsed) % (2 * Math.PI);
    
    // Normalize to [0, 2π]
    return phase >= 0 ? phase : phase + 2 * Math.PI;
  }

  /**
   * Set the waveform based on hand openness (controlled by left hand)
   * @param openness 0 = closed fist (sawtooth), 1 = open hand (triangle), values in between create smooth morphing
   */
  setWaveformFromOpenness(openness: number): void {
    // Clamp to [0, 1]
    const clampedOpenness = Math.max(0, Math.min(1, openness));
    
    // Map openness to waveform: 0 (closed) = sawtooth, 1 (open) = triangle
    // We'll use morphValue where 0 = sawtooth, 1 = triangle
    // Only update if value changed significantly
    if (Math.abs(this.currentWaveformMorph - clampedOpenness) < 0.01) {
      return;
    }

    this.currentWaveformMorph = clampedOpenness;

    // Update all oscillators if playing
    if (this.isPlaying) {
      this.oscillators.forEach((osc) => {
        this.applyWaveform(osc, clampedOpenness);
      });
    }
  }

  /**
   * Apply waveform to an oscillator based on openness
   * @param oscillator The oscillator to set the waveform on
   * @param openness 0 = closed fist (sawtooth), 1 = open hand (triangle)
   */
  private applyWaveform(oscillator: OscillatorNode, openness: number): void {
    // Use native types for values very close to 0 or 1 to avoid distortion
    const threshold = 0.05;
    
    if (openness <= threshold) {
      // Closed fist - sawtooth
      oscillator.type = 'sawtooth';
    } else if (openness >= 1 - threshold) {
      // Open hand - triangle
      oscillator.type = 'triangle';
    } else {
      // Morphing range - use custom periodic wave between sawtooth and triangle
      this.setCustomWaveform(oscillator, openness);
    }
  }

  /**
   * Generate a custom periodic wave that morphs between sawtooth and triangle
   * @param oscillator The oscillator to set the waveform on
   * @param openness 0 = pure sawtooth, 1 = pure triangle
   */
  private setCustomWaveform(oscillator: OscillatorNode, openness: number): void {
    if (!this.audioContext) {
      return;
    }

    // Number of harmonics to generate
    const numHarmonics = 32;
    
    // Real and imaginary parts for the periodic wave
    const real = new Float32Array(numHarmonics);
    const imag = new Float32Array(numHarmonics);

    // Sawtooth: all harmonics with amplitude 1/n = [DC=0, fund=1, 1/2, 1/3, 1/4, ...]
    // Triangle: odd harmonics only, amplitude 1/n^2, alternating sign = [DC=0, fund=1, 0, -1/9, 0, 1/25, ...]
    // Morph: blend between them
    
    for (let i = 0; i < numHarmonics; i++) {
      if (i === 0) {
        // DC component - always 0 for audio
        real[i] = 0;
        imag[i] = 0;
      } else if (i === 1) {
        // Fundamental - always amplitude 1
        real[i] = 0;
        imag[i] = 1;
      } else {
        // Higher harmonics
        // Sawtooth: amplitude = 1/i for all harmonics
        const sawtoothAmplitude = 1 / i;
        
        // Triangle: only odd harmonics, amplitude = 1/i^2, with alternating sign
        // For triangle: imag[i] = (8 / (π^2 * i^2)) * (-1)^((i-1)/2) for odd i, 0 for even i
        let triangleAmplitude = 0;
        if (i % 2 === 1) { // Odd harmonics only
          const sign = Math.pow(-1, (i - 1) / 2);
          triangleAmplitude = (8 / (Math.PI * Math.PI * i * i)) * sign;
        }
        
        // Blend between sawtooth and triangle
        const amplitude = sawtoothAmplitude * (1 - openness) + triangleAmplitude * openness;
        
        real[i] = 0;
        imag[i] = amplitude;
      }
    }

    // Create and set the periodic wave
    const periodicWave = this.audioContext.createPeriodicWave(real, imag, { disableNormalization: false });
    oscillator.setPeriodicWave(periodicWave);
  }


  /**
   * Get current waveform morph value
   */
  getCurrentWaveformMorph(): number {
    return this.currentWaveformMorph;
  }

  /**
   * Check if the synth is currently playing
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    
    // Stop LFO nodes
    if (this.lfo) {
      try {
        this.lfo.stop();
      } catch (e) {
        // Already stopped
      }
      this.lfo = null;
    }
    
    if (this.lfoOffset) {
      try {
        this.lfoOffset.stop();
      } catch (e) {
        // Already stopped
      }
      this.lfoOffset = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.filter = null;
    this.gainNode = null;
    this.lfoGain = null;
  }
}

