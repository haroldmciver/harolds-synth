# Harold's Synth

A hand-controlled synthesizer that uses webcam hand tracking to control audio parameters in real-time.

## Features

- Hand-controlled playback - synth plays when hands are detected, fades out when hands leave frame
- Chord-based drone - plays minor7 or major7 chords with smooth pitch transitions
- LFO-modulated filter - right hand position controls LFO rate (X-axis) and filter cutoff frequency (Y-axis)
- Pitch control via pinch gestures:
  - Right thumb-index: +1 semitone (toggles chord quality)
  - Left thumb-index: -1 semitone (toggles chord quality)
  - Right thumb-pinky: +2 semitones (keeps chord quality)
  - Left thumb-pinky: -2 semitones (keeps chord quality)
- Real-time visualization - spectrum analyzer and webcam preview

## Usage

1. Click the piano button to initialize the synth engine
2. Click the camera button to enable webcam
3. Put hands in frame to start playing
4. Move right hand horizontally to adjust LFO rate
5. Move right hand vertically to adjust filter cutoff
6. Use pinch gestures to change pitch (see features above)

## Installation

```bash
npm install
npm run dev
```

## Project Structure

```
src/
  ├── audio/
  │   └── SynthEngine.ts    # Audio engine with LFO, filter, and chord generation
  ├── handTracking/
  │   └── HandTracker.ts     # MediaPipe Hands integration
  ├── App.tsx                # Main component with hand tracking and synth control
  └── main.tsx               # Entry point
```

## Tech Stack

- React + TypeScript
- Vite
- Web Audio API
- MediaPipe Hands
