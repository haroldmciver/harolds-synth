# Harold's Synth

A hand-controlled synthesizer that uses webcam hand tracking to control audio parameters in real-time.

https://haroldssynth.com

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

## Deployment

This project can be deployed to various hosting platforms. The build output is in the `dist/` folder.

### Build for Production

```bash
npm run build
```

### Deployment Options

#### Netlify

1. Push your code to GitHub
2. Go to [Netlify](https://www.netlify.com/) and sign in
3. Click "Add new site" → "Import an existing project"
4. Connect your GitHub repository
5. Netlify will automatically detect the `netlify.toml` configuration
6. Click "Deploy site"

The site will be live at `https://your-site-name.netlify.app`

#### Vercel

1. Push your code to GitHub
2. Go to [Vercel](https://vercel.com/) and sign in
3. Click "Add New Project"
4. Import your GitHub repository
5. Vercel will automatically detect the `vercel.json` configuration
6. Click "Deploy"

The site will be live at `https://your-site-name.vercel.app`

#### GitHub Pages

1. Push your code to GitHub
2. Go to your repository → Settings → Pages
3. Under "Source", select "GitHub Actions"
4. The workflow in `.github/workflows/deploy.yml` will automatically deploy on push to `master` or `main`
5. Your site will be available at `https://your-username.github.io/repo-name/`

**Note:** For GitHub Pages, the base path is automatically set to `/repo-name/`. For other platforms, the app uses the root path `/`.

#### Other Platforms

For other hosting platforms (AWS S3, Firebase Hosting, etc.):

1. Run `npm run build`
2. Upload the contents of the `dist/` folder to your hosting service
3. Configure your hosting service to serve `index.html` for all routes (SPA routing)
