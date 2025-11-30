# Testing Before Deployment

## The Issue

MediaPipe Hands was failing to initialize in production builds because Vite transforms the module exports differently than in development. The error was: `MediaPipe Hands class not available`.

## How to Test Locally Before Deploying

### 1. Build the production version:
```bash
npm run build
```

### 2. Test the production build locally:
```bash
npm run preview
```

This starts a local server (usually at `http://localhost:4173`) that serves your production build. Open it in your browser and test:
- Click the piano button to initialize audio
- Click the camera button to start hand tracking
- Verify that hand tracking works without errors

### 3. Check the build output:
```bash
npm run test-build
```

This verifies that:
- The `dist/` folder exists
- MediaPipe chunk is present
- All necessary files are built

## What We Fixed

1. **Dynamic Import**: Changed to use dynamic `import()` for MediaPipe to handle different export structures
2. **Multiple Fallback Methods**: Added code to try multiple ways to access the Hands class:
   - `default.Hands` (normal ES module)
   - Direct `Hands` export
   - Searching through all exports for constructor functions
3. **Better Error Messages**: Added detailed debugging information if Hands class still can't be found
4. **Vite Configuration**: Updated to better handle MediaPipe in production builds

## If Issues Persist

If you still see errors after deploying:

1. Check the browser console for the detailed error message
2. Look for the "MediaPipe module debug info" log - it shows what's actually available
3. The error message will list all available keys in the module

## Quick Test Commands

```bash
# Full test workflow
npm run build && npm run test-build && npm run preview
```

Then open http://localhost:4173 and test the hand tracking functionality.

