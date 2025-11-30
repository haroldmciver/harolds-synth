#!/usr/bin/env node
/**
 * Test script to verify the production build works correctly
 * Run: node test-build.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Testing production build...\n');

// Check if dist folder exists
try {
  const indexPath = join(__dirname, 'dist', 'index.html');
  const indexContent = readFileSync(indexPath, 'utf-8');
  console.log('✓ dist/index.html exists');
  
  // Check for MediaPipe in built files
  const fs = await import('fs');
  const { readdirSync } = fs.default || fs;
  const assetsDir = join(__dirname, 'dist', 'assets');
  const assets = readdirSync(assetsDir);
  
  const hasMediaPipe = assets.some(f => f.includes('mediapipe') || f.includes('hands'));
  console.log(hasMediaPipe ? '✓ MediaPipe chunk found' : '⚠ MediaPipe chunk not found');
  
  console.log('\nBuild files:');
  assets.forEach(f => console.log(`  - ${f}`));
  
  console.log('\n✓ Production build looks good!');
  console.log('\nTo test locally, run: npm run preview');
  console.log('Then open http://localhost:4173 in your browser');
  
} catch (error) {
  console.error('✗ Build test failed:', error.message);
  console.error('\nRun "npm run build" first to create the dist folder');
  process.exit(1);
}

