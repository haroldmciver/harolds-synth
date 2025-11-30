import { useState, useEffect, useRef } from 'react';
import { SynthEngine } from './audio/SynthEngine';
import { HandTracker, HandDetectionResult } from './handTracking/HandTracker';
import './App.css';

function App() {
  // Audio state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSynthInitialized, setIsSynthInitialized] = useState(false);
  
  // Camera state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  // Hand tracking state - separate left and right hands
  const [leftHandDetected, setLeftHandDetected] = useState(false);
  const [leftHandCenterY, setLeftHandCenterY] = useState<number | null>(null); // Left hand Y position for LFO depth control
  const [leftHandPinchDown, setLeftHandPinchDown] = useState(false); // Left hand thumb-index pinch for pitch down -1
  const [leftHandPinchPinky, setLeftHandPinchPinky] = useState(false); // Left hand thumb-pinky pinch for pitch down -2
  const [leftHandPinchRing, setLeftHandPinchRing] = useState(false); // Left hand thumb-ring pinch for chord extension toggle
  
  const [rightHandDetected, setRightHandDetected] = useState(false);
  const [rightHandCenterY, setRightHandCenterY] = useState<number | null>(null);
  const [rightHandCenterX, setRightHandCenterX] = useState<number | null>(null);
  const [rightHandPinchUp, setRightHandPinchUp] = useState(false); // Right hand thumb-index pinch for pitch up +1
  const [rightHandPinchPinky, setRightHandPinchPinky] = useState(false); // Right hand thumb-pinky pinch for pitch up +2
  
  // Pitch mode state
  const [pitchMode, setPitchMode] = useState(false);
  const [rootMidi, setRootMidi] = useState(48); // C4, default to C minor 7
  const [chordExtension, setChordExtension] = useState<7 | 9>(7); // 7th or 9th chord
  const [chordQuality, setChordQuality] = useState<'minor' | 'major'>('minor'); // Minor or major
  const [showInstructions, setShowInstructions] = useState(false);
  
  // Refs
  const synthEngineRef = useRef<SynthEngine | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handTrackerRef = useRef<HandTracker | null>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Smoothing for hand tracking (to avoid jitter)
  const smoothedRightHandCenterYRef = useRef<number>(0.5);
  const smoothedRightHandCenterXRef = useRef<number>(0.5);
  const smoothedLeftHandCenterYRef = useRef<number>(0.5);
  
  // Pitch mode tracking - track previous pinch states to detect transitions
  const previousRightPinchUpRef = useRef<boolean>(false);
  const previousLeftPinchDownRef = useRef<boolean>(false);
  const previousRightPinchPinkyRef = useRef<boolean>(false);
  const previousLeftPinchPinkyRef = useRef<boolean>(false);
  const previousLeftPinchRingRef = useRef<boolean>(false);
  const lastPitchChangeTimeRef = useRef<number>(0);
  const lastChordToggleTimeRef = useRef<number>(0);
  const PITCH_CHANGE_DEBOUNCE_MS = 500; // 0.5 seconds delay between pitch changes
  const CHORD_TOGGLE_DEBOUNCE_MS = 300; // 0.3 seconds delay between chord toggles

  // Initialize synth engine on mount
  useEffect(() => {
    synthEngineRef.current = new SynthEngine();
    handTrackerRef.current = new HandTracker();
    
    return () => {
      // Cleanup on unmount
      try {
        if (synthEngineRef.current) {
          synthEngineRef.current.dispose();
        }
      } catch (error) {
        console.warn('Error disposing synth engine (non-critical):', error);
      }
      
      try {
        if (handTrackerRef.current) {
          handTrackerRef.current.stop();
        }
      } catch (error) {
        console.warn('Error stopping hand tracker (non-critical):', error);
      }
      
      // Cleanup camera stream
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => {
            try {
              track.stop();
            } catch (error) {
              // Ignore individual track stop errors
            }
          });
        }
      } catch (error) {
        console.warn('Error stopping camera stream (non-critical):', error);
      }
    };
  }, []);

  // ===== AUDIO LOGIC =====
  const handleStartStop = async () => {
    const synth = synthEngineRef.current;
    if (!synth) {
      return;
    }

    if (isSynthInitialized) {
      // Stop and de-initialize
      synth.stop();
      setIsPlaying(false);
      setIsSynthInitialized(false);
      synth.dispose();
      synthEngineRef.current = new SynthEngine();
    } else {
      // Initialize audio context if needed (requires user gesture)
      try {
        await synth.initialize();
        setIsSynthInitialized(true);
        
        // Don't start playing here - let hand detection control it
      } catch (error) {
        console.error('Failed to initialize synth:', error);
        alert('Failed to initialize audio. Please check your browser permissions.');
      }
    }
  };

  // ===== AUTOMATIC SYNTH PLAY/STOP BASED ON HAND DETECTION =====
  useEffect(() => {
    const synth = synthEngineRef.current;
    if (!synth || !isSynthInitialized) {
      return; // Only control playback if synth is initialized
    }

    // Check if any hands are detected
    const anyHandDetected = leftHandDetected || rightHandDetected;

    if (anyHandDetected) {
      // Hands detected - ensure oscillators are running and fade in
      if (!isPlaying) {
        // Set chord from state before starting
        synth.setChord(rootMidi, chordExtension, chordQuality);
        // Start oscillators if not already started
        synth.start();
        setIsPlaying(true);
        // Fade in after a tiny delay to ensure oscillators have started
        setTimeout(() => synth.fadeIn(), 10);
      } else {
        // Oscillators already running, just fade in the volume
        synth.fadeIn();
      }
    } else {
      // No hands detected - fade out (but keep oscillators running)
      if (isPlaying) {
        synth.fadeOut();
      }
    }
  }, [leftHandDetected, rightHandDetected, isSynthInitialized, isPlaying, rootMidi, chordExtension, chordQuality]);

  // ===== HAND TRACKING INITIALIZATION =====
  useEffect(() => {
    if (!isCameraActive || !videoRef.current || !handTrackerRef.current) {
      return;
    }

    const video = videoRef.current;
    const handTracker = handTrackerRef.current;

    // Initialize hand tracking when camera becomes active
    let isMounted = true;
    const initializeHandTracking = async () => {
      try {
        // Check if still mounted before initializing
        if (!isMounted || !video || !handTracker) {
          return;
        }
        
        await handTracker.initialize(video, (result: HandDetectionResult) => {
          // Only update state if component is still mounted
          if (!isMounted) {
            return;
          }
          
          // Update state with hand detection results - separate left and right
          setLeftHandDetected(result.leftHand.detected);
          setLeftHandCenterY(result.leftHand.detected ? result.leftHand.centerY : null);
          setLeftHandPinchDown(result.leftHand.detected ? result.leftHand.pinchUp : false); // Left thumb-index = pitch down -1
          setLeftHandPinchPinky(result.leftHand.detected ? result.leftHand.pinchPinky : false); // Left thumb-pinky = pitch down -2
          setLeftHandPinchRing(result.leftHand.detected ? result.leftHand.pinchRing : false); // Left thumb-ring = chord extension toggle
          
          setRightHandDetected(result.rightHand.detected);
          setRightHandCenterY(result.rightHand.detected ? result.rightHand.centerY : null);
          setRightHandCenterX(result.rightHand.detected ? result.rightHand.centerX : null);
          setRightHandPinchUp(result.rightHand.detected ? result.rightHand.pinchUp : false); // Right thumb-index = pitch up +1
          setRightHandPinchPinky(result.rightHand.detected ? result.rightHand.pinchPinky : false); // Right thumb-pinky = pitch up +2
        });
      } catch (error) {
        // Only set error if still mounted
        if (isMounted) {
          console.error('Failed to initialize hand tracking:', error);
          setCameraError('Failed to initialize hand tracking');
        }
      }
    };

    // Wait a bit for video to be ready
    const timer = setTimeout(() => {
      if (isMounted) {
        initializeHandTracking();
      }
    }, 500);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (handTracker) {
        try {
          handTracker.stop();
        } catch (error) {
          // Ignore cleanup errors
          console.warn('Error stopping hand tracker (non-critical):', error);
        }
      }
    };
  }, [isCameraActive]);

  // ===== PITCH CONTROL: PINCH GESTURES (Both Hands) =====
  useEffect(() => {
    const synth = synthEngineRef.current;
    if (!synth || !isPlaying) {
      return;
    }

    // Check if enough time has passed since last pitch change (debounce)
    const now = Date.now();
    const timeSinceLastChange = now - lastPitchChangeTimeRef.current;
    const canChangePitch = timeSinceLastChange >= PITCH_CHANGE_DEBOUNCE_MS;

    // Right hand: Thumb-Index pinch → Pitch up (+1 semitone)
    const rightPinchUpJustActivated = rightHandDetected && rightHandPinchUp && !previousRightPinchUpRef.current;
    
    // Left hand: Thumb-Index pinch → Pitch down (-1 semitone)
    const leftPinchDownJustActivated = leftHandDetected && leftHandPinchDown && !previousLeftPinchDownRef.current;
    
    // Right hand: Thumb-Pinky pinch → Pitch up (+2 semitones)
    const rightPinchPinkyJustActivated = rightHandDetected && rightHandPinchPinky && !previousRightPinchPinkyRef.current;
    
    // Left hand: Thumb-Pinky pinch → Pitch down (-2 semitones)
    const leftPinchPinkyJustActivated = leftHandDetected && leftHandPinchPinky && !previousLeftPinchPinkyRef.current;

    // Right hand pitch up +2 (thumb-pinky) - takes priority over +1
    if (rightPinchPinkyJustActivated && canChangePitch) {
      const newRootMidi = Math.min(84, rootMidi + 2);
      // Keep same chord extension and quality
      
      setRootMidi(newRootMidi);
      synth.setChord(newRootMidi, chordExtension, chordQuality);
      setPitchMode(true);
      lastPitchChangeTimeRef.current = now;
    }
    // Left hand pitch down -2 (thumb-pinky) - takes priority over -1
    else if (leftPinchPinkyJustActivated && canChangePitch) {
      const newRootMidi = Math.max(36, rootMidi - 2);
      // Keep same chord extension and quality
      
      setRootMidi(newRootMidi);
      synth.setChord(newRootMidi, chordExtension, chordQuality);
      setPitchMode(true);
      lastPitchChangeTimeRef.current = now;
    }
    // Right hand pitch up +1 (thumb-index) - only if pinky not active
    else if (rightPinchUpJustActivated && canChangePitch && !rightHandPinchPinky) {
      const newRootMidi = Math.min(84, rootMidi + 1);
      const newQuality: 'minor' | 'major' = chordQuality === 'minor' ? 'major' : 'minor';
      
      setRootMidi(newRootMidi);
      setChordQuality(newQuality);
      synth.setChord(newRootMidi, chordExtension, newQuality);
      setPitchMode(true);
      lastPitchChangeTimeRef.current = now;
    }
    // Left hand pitch down -1 (thumb-index) - only if pinky not active
    else if (leftPinchDownJustActivated && canChangePitch && !leftHandPinchPinky) {
      const newRootMidi = Math.max(36, rootMidi - 1);
      const newQuality: 'minor' | 'major' = chordQuality === 'minor' ? 'major' : 'minor';
      
      setRootMidi(newRootMidi);
      setChordQuality(newQuality);
      synth.setChord(newRootMidi, chordExtension, newQuality);
      setPitchMode(true);
      lastPitchChangeTimeRef.current = now;
    }

    // Update previous states
    previousRightPinchUpRef.current = rightHandDetected && rightHandPinchUp;
    previousLeftPinchDownRef.current = leftHandDetected && leftHandPinchDown;
    previousRightPinchPinkyRef.current = rightHandDetected && rightHandPinchPinky;
    previousLeftPinchPinkyRef.current = leftHandDetected && leftHandPinchPinky;

    // Exit pitch mode when no pinches are active
    if ((!rightHandDetected || (!rightHandPinchUp && !rightHandPinchPinky)) && 
        (!leftHandDetected || (!leftHandPinchDown && !leftHandPinchPinky))) {
      setPitchMode(false);
    }
  }, [rightHandPinchUp, leftHandPinchDown, rightHandPinchPinky, leftHandPinchPinky, rightHandDetected, leftHandDetected, isPlaying, rootMidi, chordQuality]);

  // ===== CHORD EXTENSION TOGGLE: LEFT HAND THUMB-RING PINCH =====
  useEffect(() => {
    const synth = synthEngineRef.current;
    if (!synth || !isPlaying) {
      return;
    }

    // Check if enough time has passed since last chord toggle (debounce)
    const now = Date.now();
    const timeSinceLastToggle = now - lastChordToggleTimeRef.current;
    const canToggleChord = timeSinceLastToggle >= CHORD_TOGGLE_DEBOUNCE_MS;

    // Left hand: Thumb-Ring pinch → Toggle between 7 and 9 chords
    const leftPinchRingJustActivated = leftHandDetected && leftHandPinchRing && !previousLeftPinchRingRef.current;

    if (leftPinchRingJustActivated && canToggleChord) {
      // Toggle between 7 and 9 chords
      const newExtension: 7 | 9 = chordExtension === 7 ? 9 : 7;
      
      setChordExtension(newExtension);
      synth.setChord(rootMidi, newExtension, chordQuality);
      lastChordToggleTimeRef.current = now;
    }

    // Update previous state
    previousLeftPinchRingRef.current = leftHandDetected && leftHandPinchRing;
  }, [leftHandPinchRing, leftHandDetected, isPlaying, chordExtension, rootMidi, chordQuality]);

  // ===== SPECTRUM VISUALIZATION =====
  useEffect(() => {
    if (!isPlaying || !spectrumCanvasRef.current) {
      return;
    }

    const synth = synthEngineRef.current;
    const analyser = synth?.getAnalyser();
    const canvas = spectrumCanvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!analyser || !ctx) {
      return;
    }

    // Set canvas size
    const container = canvas.parentElement;
    if (container) {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!isPlaying || !analyser || !ctx) {
        return;
      }

      animationFrameRef.current = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      // Clear canvas
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw frequency bars
      let barHeight;
      let x = 0;

      // Get current filter cutoff for visualization
      const currentCutoff = synth?.getCurrentFilterCutoff() || 1000;
      const sampleRate = synth?.getAnalyser()?.context.sampleRate || 44100;
      const nyquistFreq = sampleRate / 2; // Actual Nyquist frequency (~22050 Hz)
      
      // Scale x-axis to show 0-8000 Hz (matching filter range) for better visualization
      const displayMaxFreq = 8000; // Maximum frequency to display on x-axis
      
      // Only display frequencies up to displayMaxFreq
      const maxDisplayBin = Math.floor((displayMaxFreq / nyquistFreq) * bufferLength);
      
      // Adjust bar width to fill the canvas with the displayed range
      const barWidth = canvas.width / maxDisplayBin * 2.5;

      // Only draw frequencies up to displayMaxFreq
      for (let i = 0; i < maxDisplayBin; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height * 0.8;

        // Color based on frequency and filter cutoff
        // Map i to the scaled display range
        const displayFreq = (i / maxDisplayBin) * displayMaxFreq;
        const isBelowCutoff = displayFreq < currentCutoff;
        
        // Gradient: low frequencies = blue, high = red, filtered out = gray
        if (isBelowCutoff) {
          // Active frequencies - gradient from blue to green to yellow
          const ratio = currentCutoff > 0 ? displayFreq / currentCutoff : 0;
          if (ratio < 0.33) {
            ctx.fillStyle = `rgb(${Math.floor(100 + ratio * 155)}, ${Math.floor(150 + ratio * 105)}, 255)`;
          } else if (ratio < 0.66) {
            ctx.fillStyle = `rgb(${Math.floor(100 + (ratio - 0.33) * 255)}, 255, ${Math.floor(255 - (ratio - 0.33) * 255)})`;
          } else {
            ctx.fillStyle = `rgb(255, ${Math.floor(255 - (ratio - 0.66) * 155)}, 0)`;
          }
        } else {
          // Filtered out frequencies - dim gray
          ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
        }

        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }

      // Draw LFO-modulated filter cutoff curve
      const lfoParams = synth?.getLfoParams();
      if (lfoParams && synth) {
        // Use audio context time for accurate LFO phase
        const audioContext = synth.getAnalyser()?.context;
        if (audioContext) {
          const range = lfoParams.maxCutoff - lfoParams.minCutoff;
          const depth = (range * lfoParams.depth) / 2;
          const baseCutoff = (lfoParams.minCutoff + lfoParams.maxCutoff) / 2;
          
          // Get the actual current frequency and LFO phase
          const currentFreq = synth.getActualFilterFrequency();
          const currentLfoPhase = synth.getLfoPhase();
          
          // Draw a curved line showing the LFO oscillation pattern
          // Synchronize it with the actual LFO phase so the dot follows the curve
          ctx.strokeStyle = '#00ff88';
          ctx.lineWidth = 2.5;
          ctx.globalAlpha = 0.8;
          ctx.beginPath();
          
          // Draw 2-3 cycles of the LFO to show the oscillation pattern
          const cyclesToShow = 2.5; // Show 2.5 cycles
          const pointsPerCycle = 60;
          const totalPoints = Math.floor(cyclesToShow * pointsPerCycle);
          
          for (let i = 0; i <= totalPoints; i++) {
            const cycleProgress = (i / totalPoints) * cyclesToShow;
            const xPos = (i / totalPoints) * canvas.width;
            
            // Calculate LFO phase synchronized with actual audio time
            // Start from current phase and go forward/backward to center it
            const phaseOffset = currentLfoPhase - (1.25 * 2 * Math.PI); // Center current phase in the middle
            const lfoPhase = phaseOffset + (cycleProgress * 2 * Math.PI);
            const actualFreq = baseCutoff + (Math.sin(lfoPhase) * depth);
            const clampedFreq = Math.max(lfoParams.minCutoff, Math.min(lfoParams.maxCutoff, actualFreq));
            const yPos = canvas.height - ((clampedFreq / displayMaxFreq) * canvas.height);
            
            if (i === 0) {
              ctx.moveTo(xPos, yPos);
            } else {
              ctx.lineTo(xPos, yPos);
            }
          }
          
          ctx.stroke();
          ctx.globalAlpha = 1.0;

          // Draw current filter position indicator (bright dot showing real-time position)
          // Position the dot on the curve at the center (where current phase is)
          const dotXPosition = 0.5; // Position dot at center of canvas
          const dotX = dotXPosition * canvas.width;
          
          // Calculate the Y position based on the curve at this X (should match currentFreq)
          const dotCycleProgress = dotXPosition * cyclesToShow;
          const dotPhaseOffset = currentLfoPhase - (1.25 * 2 * Math.PI);
          const dotLfoPhase = dotPhaseOffset + (dotCycleProgress * 2 * Math.PI);
          const dotExpectedFreq = baseCutoff + (Math.sin(dotLfoPhase) * depth);
          const dotExpectedY = canvas.height - ((Math.max(lfoParams.minCutoff, Math.min(lfoParams.maxCutoff, dotExpectedFreq)) / displayMaxFreq) * canvas.height);
          
          // Draw a glowing dot at the current filter position (on the curve)
          ctx.fillStyle = '#00ff88';
          ctx.shadowBlur = 10;
          ctx.shadowColor = '#00ff88';
          ctx.beginPath();
          ctx.arc(dotX, dotExpectedY, 6, 0, 2 * Math.PI);
          ctx.fill();
          ctx.shadowBlur = 0;
          
          // Draw label for current frequency
          ctx.fillStyle = '#00ff88';
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`LFO: ${Math.round(currentFreq)} Hz`, dotX + 10, dotExpectedY - 8);
        }
      }

      // Draw static filter cutoff line (base/center) for reference
      const cutoffX = (currentCutoff / displayMaxFreq) * canvas.width;
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(cutoffX, 0);
      ctx.lineTo(cutoffX, canvas.height);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw cutoff label
      ctx.fillStyle = '#ff6b6b';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`Base: ${Math.round(currentCutoff)} Hz`, cutoffX + 5, 15);
    };

    draw();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying]);

  // ===== RIGHT HAND: LFO & FILTER CONTROL =====
  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const synth = synthEngineRef.current;
    if (!synth) {
      return;
    }

    // Smoothing factors
    const smoothingFactor = 0.85; // For Y and X positions

    if (rightHandDetected && rightHandCenterY !== null && rightHandCenterX !== null) {
      // RIGHT HAND DETECTED - Control LFO and max cutoff (unless in pitch mode)

      // Apply smoothing to right hand center Y
      smoothedRightHandCenterYRef.current = 
        smoothedRightHandCenterYRef.current * smoothingFactor + 
        rightHandCenterY * (1 - smoothingFactor);

      // Apply smoothing to right hand center X
      smoothedRightHandCenterXRef.current = 
        smoothedRightHandCenterXRef.current * smoothingFactor + 
        rightHandCenterX * (1 - smoothingFactor);

      // Only control filter cutoff if NOT pinching (pitch mode)
      if (!rightHandPinchUp && !leftHandPinchDown) {
        // Map right hand Y position to MAX cutoff frequency: y=0 (top) → 8000Hz, y=1 (bottom) → 300Hz
        const normalizedY = smoothedRightHandCenterYRef.current;
        const minCutoff = 300;
        const maxCutoffValue = 8000;
        const calculatedMaxCutoff = minCutoff * Math.pow(maxCutoffValue / minCutoff, 1 - normalizedY);

        synth.setMaxFilterCutoff(calculatedMaxCutoff);
      }

      // Map right hand X position to LFO rate: x=0 (left) → 0.1Hz, x=1 (right) → 7Hz
      const normalizedX = smoothedRightHandCenterXRef.current;
      const minLfoRate = 1;
      const maxLfoRate = 1000.0;
      const calculatedLfoRate = minLfoRate * Math.pow(maxLfoRate / minLfoRate, normalizedX);

      synth.setLfoRate(calculatedLfoRate);
    } else {
      // NO RIGHT HAND DETECTED - Use safe defaults
      synth.setLfoRate(0.2);
      
      synth.setMaxFilterCutoff(1000);
    }
  }, [rightHandDetected, rightHandCenterY, rightHandCenterX, isPlaying, pitchMode]);

  // ===== LEFT HAND: LFO DEPTH CONTROL =====
  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const synth = synthEngineRef.current;
    if (!synth) {
      return;
    }

    // Smoothing factor (same as right hand)
    const smoothingFactor = 0.85;

    if (leftHandDetected && leftHandCenterY !== null) {
      // LEFT HAND DETECTED - Control LFO depth (unless pinching for pitch or chord toggle)
      
      // Only control LFO depth if NOT pinching (pitch mode and chord toggle take priority)
      if (!leftHandPinchDown && !leftHandPinchPinky && !leftHandPinchRing) {
        // Apply smoothing to left hand center Y
        smoothedLeftHandCenterYRef.current = 
          smoothedLeftHandCenterYRef.current * smoothingFactor + 
          leftHandCenterY * (1 - smoothingFactor);

        // Map left hand Y position to LFO depth:
        // y=0 (top) → depth = 1.0 (100% - maximum modulation)
        // y=1 (bottom) → depth = 0.1 (10% - subtle modulation)
        // Inverted: higher hand = more depth (more modulation)
        const normalizedY = smoothedLeftHandCenterYRef.current;
        const minDepth = 0.1; // 10% minimum depth
        const maxDepth = 1.0; // 100% maximum depth
        
        // Linear mapping: top (0.0) = 1.0, bottom (1.0) = 0.1
        const calculatedDepth = maxDepth - (normalizedY * (maxDepth - minDepth));

        synth.setLfoDepth(calculatedDepth);
      }
    } else {
      // NO LEFT HAND DETECTED - Use default depth
      synth.setLfoDepth(1.0); // Default to full depth
    }
  }, [leftHandDetected, leftHandCenterY, isPlaying, leftHandPinchDown, leftHandPinchPinky, leftHandPinchRing]);

  // ===== CAMERA LOGIC =====
  const handleEnableCamera = async () => {
    if (isCameraActive) {
      // Stop camera
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setIsCameraActive(false);
      setCameraError(null);
      return;
    }

    // Request camera access
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user' // Front-facing camera
        }
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        streamRef.current = stream;
        setIsCameraActive(true);
      }
    } catch (error) {
      console.error('Failed to access camera:', error);
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Failed to access camera. Please check your browser permissions.';
      setCameraError(errorMessage);
      setIsCameraActive(false);
    }
  };

  return (
    <div className="app">
      <div className="container">
        <div className="left-panel">
          <div className="header"> 
            <h1>harolds synth</h1>
            <p className="subtitle">i made a hand controlled synth</p>
          </div>

          <div className="controls">
            <button 
              className={`start-stop-button ${isSynthInitialized ? 'active' : ''}`}
              onClick={handleStartStop}
            >
              🎹
            </button>
            <button 
              className={`camera-button ${isCameraActive ? 'active' : ''}`}
              onClick={handleEnableCamera}
            >
              📷
            </button>
          </div>

          {cameraError && (
            <div className="error-message">
              {cameraError}
            </div>
          )}

          <div className="chord-extension-controls">
            <div className="chord-extension-label">Chord Extension:</div>
            <div className="chord-extension-buttons">
              <button
                className={`chord-extension-button ${chordExtension === 7 ? 'active' : ''}`}
                onClick={() => {
                  setChordExtension(7);
                  if (synthEngineRef.current && isSynthInitialized) {
                    synthEngineRef.current.setChord(rootMidi, 7, chordQuality);
                  }
                }}
              >
                7
              </button>
              <button
                className={`chord-extension-button ${chordExtension === 9 ? 'active' : ''}`}
                onClick={() => {
                  setChordExtension(9);
                  if (synthEngineRef.current && isSynthInitialized) {
                    synthEngineRef.current.setChord(rootMidi, 9, chordQuality);
                  }
                }}
              >
                9
              </button>
            </div>
          </div>

          <div className="debug-info">
            <div className="debug-item">
              <span className="label">Chord:</span>
              <span className="value">
                {(() => {
                  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                  const note = noteNames[rootMidi % 12];
                  const qualitySymbol = chordQuality === 'minor' ? 'm' : '';
                  const extensionSymbol = chordExtension === 7 ? '7' : '9';
                  return `${note}${qualitySymbol}${extensionSymbol}`;
                })()}
              </span>
            </div>
          </div>

          <div className="help-container">
            <button 
              className={`help-button ${showInstructions ? 'active' : ''}`}
              onClick={() => setShowInstructions(!showInstructions)}
              title="How to play"
            >
              ?
            </button>

            {showInstructions && (
              <div className="inline-instructions">
                <div className="instruction-section">
                  <h3>Pitch Control (Pinch Gestures)</h3>
                  <ul>
                    <li><strong>Right Thumb + Index:</strong> +1 Semitone</li>
                    <li><strong>Right Thumb + Pinky:</strong> +2 Semitones</li>
                    <li><strong>Left Thumb + Index:</strong> -1 Semitone</li>
                    <li><strong>Left Thumb + Pinky:</strong> -2 Semitones</li>
                  </ul>
                </div>
                
                <div className="instruction-section">
                  <h3>Chord Control</h3>
                  <ul>
                    <li><strong>Left Thumb + Ring:</strong> Switch 7th / 9th Chord</li>
                  </ul>
                </div>

                <div className="instruction-section">
                  <h3>Effects (Hand Position)</h3>
                  <ul>
                    <li><strong>Right Hand X:</strong> LFO Rate</li>
                    <li><strong>Right Hand Y:</strong> Filter Cutoff</li>
                    <li><strong>Left Hand Y:</strong> LFO Depth</li>
                  </ul>
                </div>
                
                <p className="instruction-note">
                  Move hands up/down and side-to-side to explore effects!
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="right-panel">
          {/* Spectrum analyzer visualization */}
          <div className="spectrum-container">
            <canvas
              ref={spectrumCanvasRef}
              className="spectrum-canvas"
              width="640"
              height="200"
            />
          </div>

          {/* Video preview - ready for hand tracking frame processing */}
          <div className="video-container">
            <video
              ref={videoRef}
              className="video-preview"
              autoPlay
              playsInline
              muted
              width="640"
              height="480"
            />
            {!isCameraActive && (
              <div className="video-placeholder">
                <p>Camera feed will appear here</p>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Instructions removed from here as they are now inline */}
    </div>
  );
}

export default App;

