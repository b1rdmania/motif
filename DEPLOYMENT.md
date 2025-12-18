# Deployment Guide for Motif

## iOS Fixes Applied
- ✓ Fixed auto-zoom on input focus (font-size: 16px, viewport locked)
- ✓ Prevented zoom on touch (maximum-scale=1.0, user-scalable=no)

## Backend Deployment

The MIDI search requires a backend server to be running. You have two options:

### Option 1: Deploy Backend Separately (Recommended for Production)

1. Deploy the backend to a service like Render, Railway, or Heroku:
   ```bash
   cd server
   npm install
   npm run build
   npm start
   ```

2. Set the `VITE_API_URL` environment variable in your frontend deployment to point to your backend:
   ```
   VITE_API_URL=https://your-backend-url.com
   ```

### Option 2: Run Backend Locally (Development Only)

1. In one terminal, start the backend:
   ```bash
   npm run dev:backend
   ```

2. In another terminal, start the frontend:
   ```bash
   npm run dev
   ```

## Vercel Deployment

### Deploy Frontend to Vercel:

1. Build the project:
   ```bash
   npm run build
   ```

2. Deploy to Vercel:
   ```bash
   vercel --prod
   ```

3. Set environment variable in Vercel dashboard:
   - Variable name: `VITE_API_URL`
   - Value: Your deployed backend URL (e.g., `https://motif-backend.onrender.com`)

### Deploy Backend to Render/Railway:

1. Create a new Web Service
2. Connect your GitHub repository
3. Set build command: `cd server && npm install && npm run build`
4. Set start command: `cd server && npm start`
5. Add environment variable `PORT` (usually auto-set)
6. Deploy

## Environment Variables

Create a `.env` file in the root directory for local development:

```bash
VITE_API_URL=http://localhost:3001
```

For production, set this in your deployment platform (Vercel, Netlify, etc.):

```bash
VITE_API_URL=https://your-backend-api-url.com
```

## Testing the Deployment

1. Open the deployed URL on iOS Safari
2. Search for a song (e.g., "Hotel California")
3. You should see MIDI results load
4. Select a result and play it
5. The page should NOT zoom when touching the search input

## Troubleshooting

### No search results on production:
- Check that backend is running (visit `https://your-backend-url.com/health`)
- Verify `VITE_API_URL` environment variable is set correctly in Vercel
- Check browser console for CORS errors
- Rebuild frontend after setting environment variables

### iOS zoom issue persists:
- Clear Safari cache
- Hard reload the page
- Check that the latest build is deployed

### CORS errors:
- Backend must allow requests from your frontend domain
- Check server CORS configuration in `server/src/server.ts`
