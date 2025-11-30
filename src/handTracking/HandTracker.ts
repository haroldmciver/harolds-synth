/**
 * HandTracker - MediaPipe Hands integration for hand detection and landmark extraction
 */

export interface HandLandmarks {
  x: number;
  y: number;
  z: number;
}

export interface HandData {
  detected: boolean;
  centerY: number; // Normalized [0,1], where 0 = top, 1 = bottom
  centerX: number; // Normalized [0,1], where 0 = left, 1 = right
  openness: number; // Normalized [0,1], where 0 = closed, 1 = fully open
  isPinched: boolean; // true if thumb and index finger are pinched together
  pinchUp: boolean; // true if thumb and index finger are pinched (for pitch up +1)
  pinchDown: boolean; // true if thumb and middle finger are pinched (for pitch down -1)
  pinchPinky: boolean; // true if thumb and pinky are pinched (for pitch ±2)
  pinchRing: boolean; // true if thumb and ring finger are pinched (for chord extension toggle)
}

export interface HandDetectionResult {
  leftHand: HandData;
  rightHand: HandData;
}

export class HandTracker {
  private hands: any | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private onResultsCallback: ((result: HandDetectionResult) => void) | null = null;
  private animationFrameId: number | null = null;
  private isProcessing: boolean = false;

  /**
   * Initialize MediaPipe Hands model
   */
  async initialize(videoElement: HTMLVideoElement, onResults: (result: HandDetectionResult) => void): Promise<void> {
    this.videoElement = videoElement;
    this.onResultsCallback = onResults;

    // Use dynamic import to ensure it works correctly in production builds
    // MediaPipe exports Hands on the default export in ES modules
    // Vite may transform the exports, so we need to handle multiple cases
    const mediaPipeModule = await import('@mediapipe/hands');
    
    // Try multiple ways to access Hands class
    // 1. Default export with Hands property (normal ES module)
    // 2. Direct Hands export (named export)
    // 3. Check if default is an object with Hands
    // 4. Check for transformed exports (Vite may rename)
    let Hands: any = null;
    
    // Method 1: default.Hands
    if (mediaPipeModule.default?.Hands && typeof mediaPipeModule.default.Hands === 'function') {
      Hands = mediaPipeModule.default.Hands;
    }
    // Method 2: Direct Hands export
    else if (mediaPipeModule.Hands && typeof mediaPipeModule.Hands === 'function') {
      Hands = mediaPipeModule.Hands;
    }
    // Method 3: Check if default itself is the Hands class (unlikely but possible)
    else if (typeof mediaPipeModule.default === 'function' && (mediaPipeModule.default as any).prototype) {
      Hands = mediaPipeModule.default;
    }
    // Method 5: Check global scope (window.Hands) - common for UMD modules
    else if (typeof window !== 'undefined' && (window as any).Hands) {
      Hands = (window as any).Hands;
    }
    // Method 6: Check globalThis.Hands
    else if (typeof globalThis !== 'undefined' && (globalThis as any).Hands) {
      Hands = (globalThis as any).Hands;
    }
    // Method 4: Search through all exports for a constructor function
    else {
      const allKeys = Object.keys(mediaPipeModule);
      for (const key of allKeys) {
        const value = (mediaPipeModule as any)[key];
        // Check if it's a class/constructor that might be Hands
        if (typeof value === 'function' && value.prototype && 
            (key.toLowerCase().includes('hand') || value.name === 'Hands' || value.name === 'lr')) {
          Hands = value;
          break;
        }
        // Check if it's an object with Hands property
        if (value && typeof value === 'object' && value.Hands && typeof value.Hands === 'function') {
          Hands = value.Hands;
          break;
        }
      }
    }
    
    if (!Hands || typeof Hands !== 'function') {
      // Enhanced error reporting
      const debugInfo = {
        hasDefault: !!mediaPipeModule.default,
        defaultType: typeof mediaPipeModule.default,
        defaultKeys: mediaPipeModule.default && typeof mediaPipeModule.default === 'object' 
          ? Object.keys(mediaPipeModule.default) : [],
        moduleKeys: Object.keys(mediaPipeModule),
        windowHands: typeof window !== 'undefined' ? typeof (window as any).Hands : 'undefined',
        globalHands: typeof globalThis !== 'undefined' ? typeof (globalThis as any).Hands : 'undefined',
        moduleValues: Object.keys(mediaPipeModule).reduce((acc, key) => {
          const val = (mediaPipeModule as any)[key];
          acc[key] = {
            type: typeof val,
            isFunction: typeof val === 'function',
            name: typeof val === 'function' ? val.name : undefined,
            hasHands: val && typeof val === 'object' && 'Hands' in val
          };
          return acc;
        }, {} as any)
      };
      console.error('MediaPipe module debug info:', debugInfo);
      throw new Error('MediaPipe Hands class not found. Module keys: ' + Object.keys(mediaPipeModule).join(', '));
    }

    this.hands = new Hands({
      locateFile: (file: string) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
      }
    });

    this.hands.setOptions({
      maxNumHands: 2, // Track up to 2 hands (left and right)
      modelComplexity: 1, // 0 = fast, 1 = full
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    // Set up the callback for when results are available
    this.hands.onResults((results: any) => {
      this.processResults(results);
    });

    // Start processing frames from the existing video element
    this.startFrameProcessing();
  }

  /**
   * Process video frames using requestAnimationFrame
   */
  private startFrameProcessing(): void {
    if (!this.videoElement || !this.hands || this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    const processFrame = async () => {
      if (!this.videoElement || !this.hands || !this.isProcessing) {
        return;
      }

      // Only process if video has enough data
      if (this.videoElement.readyState >= 2) { // HAVE_CURRENT_DATA or higher
        try {
          await this.hands.send({ image: this.videoElement });
        } catch (error) {
          // Silently handle errors - don't spam console
          // MediaPipe can throw errors during initialization/cleanup
          if (this.isProcessing) {
            // Only log if we're still supposed to be processing
            console.warn('Hand tracking frame error (non-critical):', error);
          }
        }
      }

      // Only continue if still processing
      if (this.isProcessing) {
        this.animationFrameId = requestAnimationFrame(processFrame);
      }
    };

    processFrame();
  }

  /**
   * Process a single hand's landmarks and extract metrics
   */
  private processHand(landmarks: HandLandmarks[]): HandData {
    // Validate that we have a valid landmarks array with required indices
    if (!landmarks || landmarks.length < 21) {
      // Return default hand data if landmarks are incomplete
      return {
        detected: false,
        centerY: 0.5,
        centerX: 0.5,
        openness: 0,
        isPinched: false,
        pinchUp: false,
        pinchDown: false,
        pinchPinky: false,
        pinchRing: false
      };
    }

    // Validate critical landmarks exist
    const requiredIndices = [0, 4, 5, 8, 9, 12, 13, 16, 17, 20];
    const missingLandmarks = requiredIndices.filter(idx => !landmarks[idx]);
    
    if (missingLandmarks.length > 0) {
      // Return default hand data if critical landmarks are missing
      return {
        detected: false,
        centerY: 0.5,
        centerX: 0.5,
        openness: 0,
        isPinched: false,
        pinchUp: false,
        pinchDown: false,
        pinchPinky: false,
        pinchRing: false
      };
    }

    // Calculate hand center y-coordinate
    const wrist = landmarks[0];
    const palmLandmarks = [landmarks[0], landmarks[5], landmarks[9], landmarks[13], landmarks[17]].filter(lm => lm !== undefined);
    
    if (palmLandmarks.length === 0) {
      return {
        detected: false,
        centerY: 0.5,
        centerX: 0.5,
        openness: 0,
        isPinched: false,
        pinchUp: false,
        pinchDown: false,
        pinchPinky: false,
        pinchRing: false
      };
    }
    
    const palmCenterY = palmLandmarks.reduce((sum, lm) => sum + (lm?.y ?? 0), 0) / palmLandmarks.length;
    const handCenterY = (wrist.y + palmCenterY) / 2;
    
    // Calculate hand center x-coordinate
    const palmCenterX = palmLandmarks.reduce((sum, lm) => sum + (lm?.x ?? 0), 0) / palmLandmarks.length;
    const handCenterX = (wrist.x + palmCenterX) / 2;

    // Calculate hand openness
    const fingertips = [
      landmarks[4],  // Thumb tip
      landmarks[8],  // Index finger tip
      landmarks[12], // Middle finger tip
      landmarks[16], // Ring finger tip
      landmarks[20]  // Pinky tip
    ].filter(tip => tip !== undefined);

    if (fingertips.length === 0) {
      return {
        detected: false,
        centerY: handCenterY,
        centerX: handCenterX,
        openness: 0,
        isPinched: false,
        pinchUp: false,
        pinchDown: false,
        pinchPinky: false,
        pinchRing: false
      };
    }

    const palmCenter = { x: palmCenterX, y: palmCenterY };
    const distances = fingertips.map(tip => {
      if (!tip) return 0;
      const dx = tip.x - palmCenter.x;
      const dy = tip.y - palmCenter.y;
      return Math.sqrt(dx * dx + dy * dy);
    });

    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const minDistance = 0.05;
    const maxDistance = 0.25;
    const normalizedOpenness = Math.max(0, Math.min(1, (avgDistance - minDistance) / (maxDistance - minDistance)));

    // Detect different pinch gestures
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];
    
    // Validate all pinch landmarks exist before calculating distances
    if (!thumbTip || !indexTip || !middleTip || !ringTip || !pinkyTip) {
      return {
        detected: true,
        centerY: handCenterY,
        centerX: handCenterX,
        openness: normalizedOpenness,
        isPinched: false,
        pinchUp: false,
        pinchDown: false,
        pinchPinky: false,
        pinchRing: false
      };
    }
    
    // Thumb-Index pinch (for pitch up +1)
    const thumbIndexDistance = Math.sqrt(
      Math.pow(thumbTip.x - indexTip.x, 2) + 
      Math.pow(thumbTip.y - indexTip.y, 2)
    );
    
    // Thumb-Middle pinch (for pitch down -1)
    const thumbMiddleDistance = Math.sqrt(
      Math.pow(thumbTip.x - middleTip.x, 2) + 
      Math.pow(thumbTip.y - middleTip.y, 2)
    );
    
    // Thumb-Ring pinch (for chord extension toggle)
    const thumbRingDistance = Math.sqrt(
      Math.pow(thumbTip.x - ringTip.x, 2) + 
      Math.pow(thumbTip.y - ringTip.y, 2)
    );
    
    // Thumb-Pinky pinch (for pitch up/down ±2)
    const thumbPinkyDistance = Math.sqrt(
      Math.pow(thumbTip.x - pinkyTip.x, 2) + 
      Math.pow(thumbTip.y - pinkyTip.y, 2)
    );
    
    const pinchThreshold = 0.03;
    const pinchUp = thumbIndexDistance < pinchThreshold;
    const pinchDown = thumbMiddleDistance < pinchThreshold;
    const pinchRing = thumbRingDistance < pinchThreshold;
    const pinchTwo = thumbPinkyDistance < pinchThreshold;
    const isPinched = pinchUp || pinchDown || pinchRing || pinchTwo; // General pinch state (any type)
    

    return {
      detected: true,
      centerY: handCenterY,
      centerX: handCenterX,
      openness: normalizedOpenness,
      isPinched: isPinched,
      pinchUp: pinchUp,
      pinchDown: pinchDown,
      pinchPinky: pinchTwo,
      pinchRing: pinchRing
    };
  }

  /**
   * Process MediaPipe Hands results and extract hand metrics for both hands
   */
  private processResults(results: any): void {
    if (!this.onResultsCallback) {
      return;
    }

    // Default: no hands detected
    const defaultHand: HandData = {
      detected: false,
      centerY: 0.5,
      centerX: 0.5,
      openness: 0,
      isPinched: false,
      pinchUp: false,
      pinchDown: false,
      pinchPinky: false,
      pinchRing: false
    };

    let leftHandData: HandData = { ...defaultHand };
    let rightHandData: HandData = { ...defaultHand };

    // Check if hands are detected
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      // Process each detected hand
      results.multiHandLandmarks.forEach((landmarks: HandLandmarks[], index: number) => {
        try {
          // Validate landmarks array before processing
          if (!landmarks || landmarks.length === 0 || !landmarks[0]) {
            return; // Skip this hand if landmarks are invalid
          }

          const handData = this.processHand(landmarks);
          const wristX = landmarks[0]?.x ?? 0.5;
          
          // Determine if this is left or right hand
          let isRight = false;
          
          // Try to use MediaPipe's handedness classification first
          if (results.multiHandedness && 
              results.multiHandedness[index] && 
              results.multiHandedness[index].categoryName) {
            const categoryName = results.multiHandedness[index].categoryName;
            // MediaPipe's handedness is from the hand's own perspective
            // 'Right' means it's the person's right hand
            if (typeof categoryName === 'string') {
              isRight = categoryName.toLowerCase().includes('right');
            } else {
              // Fallback to screen position if categoryName is not a string
              isRight = wristX < 0.5;
            }
          } else {
            // Fallback: use screen position
            // Note: Video is mirrored, so right hand appears on left side (x < 0.5)
            // But MediaPipe's handedness should be more reliable, so this is just a fallback
            isRight = wristX < 0.5;
          }

          // Assign to appropriate hand data structure
          if (isRight) {
            rightHandData = handData;
          } else {
            leftHandData = handData;
          }
        } catch (error) {
          // Silently handle errors for individual hands - don't break the entire tracking
          // The default hand data will be used instead
          console.warn('Error processing hand landmarks (non-critical):', error);
        }
      });
    }

    this.onResultsCallback({
      leftHand: leftHandData,
      rightHand: rightHandData
    });
  }

  /**
   * Stop hand tracking and clean up resources
   */
  stop(): void {
    this.isProcessing = false;
    
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    if (this.hands) {
      try {
        this.hands.close();
      } catch (error) {
        // Ignore errors during cleanup - MediaPipe may already be closed
        console.warn('Error closing MediaPipe Hands (non-critical):', error);
      }
      this.hands = null;
    }
    
    this.videoElement = null;
    this.onResultsCallback = null;
  }
}

