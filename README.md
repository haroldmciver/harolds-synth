# Harold's Synth

A hand-controlled synthesizer that uses webcam hand tracking to control audio parameters in real-time.

## Features

- Hand-controlled playback
- Chord-based drone 
- LFO-modulated filter (right hand position controls LFO rate on X-axis and filter cutoff frequency on Y-axis)
- Pitch control via pinch gestures:
  - Right thumb-index: +1 semitone 
  - Left thumb-index: -1 semitone
  - Right thumb-pinky: +2 semitones
  - Left thumb-pinky: -2 semitones
- Real-time visualization 

## Usage

1. Click the piano button 
2. Click the camera button 
3. Put hands in frame 
4. Move right hand horizontally to adjust LFO rate
5. Move right hand vertically to adjust filter cutoff
6. Use pinch gestures to change pitch (see features above)

## Installation

```bash
npm install
npm run dev
```
