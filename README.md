# Harold's Synth

A hand-controlled synthesizer that uses webcam hand tracking to control audio parameters in real-time.

## Features

- 🎹 **Hand-controlled synthesizer** - Hands in frame = synth plays, no hands = synth fades out
- 🎵 **Chord-based drone** - Plays minor7 or major7 chords with smooth transitions
- 🎚️ **LFO-modulated filter** - Right hand position controls LFO rate and filter cutoff
- 🎯 **Pitch control** - Pinch gestures for pitch changes:
  - Thumb-index: ±1 semitone (toggles chord quality)
  - Thumb-pinky: ±2 semitones (keeps chord quality)
- 📹 **Webcam hand tracking** - Uses MediaPipe Hands for real-time gesture recognition
- 🎨 **Visual feedback** - Real-time spectrum analyzer and video preview

## How to Use

1. Click the 🎹 button to initialize the synth
2. Click the 📷 button to enable your webcam
3. Put your hands in frame to start playing
4. Move your right hand to control LFO rate (X-axis) and filter cutoff (Y-axis)
5. Use pinch gestures to change pitch:
   - Right thumb-index: +1 semitone
   - Left thumb-index: -1 semitone
   - Right thumb-pinky: +2 semitones
   - Left thumb-pinky: -2 semitones

## Tech Stack

- React + TypeScript
- Vite
- Web Audio API
- MediaPipe Hands

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
  ├── App.css                # Styles
  └── main.tsx               # Entry point
```
