/**
 * HandTracker - MediaPipe Hands integration for hand detection and landmark extraction
 */

import { Hands } from '@mediapipe/hands';

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
}

export interface HandDetectionResult {
  leftHand: HandData;
  rightHand: HandData;
}

export class HandTracker {
  private hands: Hands | null = null;
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
    // Calculate hand center y-coordinate
    const wrist = landmarks[0];
    const palmLandmarks = [landmarks[0], landmarks[5], landmarks[9], landmarks[13], landmarks[17]];
    const palmCenterY = palmLandmarks.reduce((sum, lm) => sum + lm.y, 0) / palmLandmarks.length;
    const handCenterY = (wrist.y + palmCenterY) / 2;
    
    // Calculate hand center x-coordinate
    const palmCenterX = palmLandmarks.reduce((sum, lm) => sum + lm.x, 0) / palmLandmarks.length;
    const handCenterX = (wrist.x + palmCenterX) / 2;

    // Calculate hand openness
    const fingertips = [
      landmarks[4],  // Thumb tip
      landmarks[8],  // Index finger tip
      landmarks[12], // Middle finger tip
      landmarks[16], // Ring finger tip
      landmarks[20]  // Pinky tip
    ];

    const palmCenter = { x: palmCenterX, y: palmCenterY };
    const distances = fingertips.map(tip => {
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
    const pinkyTip = landmarks[20];
    
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
    
    // Thumb-Pinky pinch (for pitch up/down ±2)
    const thumbPinkyDistance = Math.sqrt(
      Math.pow(thumbTip.x - pinkyTip.x, 2) + 
      Math.pow(thumbTip.y - pinkyTip.y, 2)
    );
    
    const pinchThreshold = 0.03;
    const pinchUp = thumbIndexDistance < pinchThreshold;
    const pinchDown = thumbMiddleDistance < pinchThreshold;
    const pinchTwo = thumbPinkyDistance < pinchThreshold;
    const isPinched = pinchUp || pinchDown || pinchTwo; // General pinch state (any type)
    

    return {
      detected: true,
      centerY: handCenterY,
      centerX: handCenterX,
      openness: normalizedOpenness,
      isPinched: isPinched,
      pinchUp: pinchUp,
      pinchDown: pinchDown,
      pinchPinky: pinchTwo
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
      pinchPinky: false
    };

    let leftHandData: HandData = { ...defaultHand };
    let rightHandData: HandData = { ...defaultHand };

    // Check if hands are detected
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      // Process each detected hand
      results.multiHandLandmarks.forEach((landmarks: HandLandmarks[], index: number) => {
        const handData = this.processHand(landmarks);
        const wristX = landmarks[0].x;
        
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

